import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeMessageId,
  parseReferences,
  threadCandidates,
  buildReferences,
  formatReferencesHeader,
  extractConversationToken,
  replyToAddress,
  normalizeSubject,
  replySubject,
  resolveThread,
  type ThreadResolvers,
} from "./threading";
import { stripQuotedText, stripQuotedHtml, toPlainText } from "./quoted";

describe("message ids", () => {
  test("strips angle brackets and whitespace", () => {
    assert.equal(normalizeMessageId("  <abc@mail.com> "), "abc@mail.com");
    assert.equal(normalizeMessageId("abc@mail.com"), "abc@mail.com");
    assert.equal(normalizeMessageId(""), null);
    assert.equal(normalizeMessageId(null), null);
  });

  test("parses a References chain in order, de-duplicated", () => {
    const header = "<a@x> <b@x>\r\n <c@x> <b@x>";
    assert.deepEqual(parseReferences(header), ["a@x", "b@x", "c@x"]);
  });

  test("ignores malformed headers rather than throwing", () => {
    assert.deepEqual(parseReferences("not a message id"), []);
    assert.deepEqual(parseReferences(undefined), []);
  });
});

describe("thread candidates", () => {
  test("In-Reply-To is tried before the References chain", () => {
    const ids = threadCandidates({
      inReplyTo: "<direct@x>",
      references: "<root@x> <mid@x>",
    });
    assert.equal(ids[0], "direct@x");
  });

  test("References are walked newest-first", () => {
    const ids = threadCandidates({ inReplyTo: null, references: "<root@x> <mid@x> <newest@x>" });
    assert.deepEqual(ids, ["newest@x", "mid@x", "root@x"]);
  });

  test("no headers yields no candidates", () => {
    assert.deepEqual(threadCandidates({}), []);
  });
});

describe("outgoing References", () => {
  test("appends the parent to its own chain", () => {
    assert.deepEqual(buildReferences(["root@x"], "parent@x"), ["root@x", "parent@x"]);
  });

  test("does not duplicate a parent already in the chain", () => {
    assert.deepEqual(buildReferences(["root@x", "parent@x"], "parent@x"), [
      "root@x",
      "parent@x",
    ]);
  });

  test("caps long chains but keeps the thread root", () => {
    const long = Array.from({ length: 40 }, (_, i) => `m${i}@x`);
    const out = buildReferences(long, "newest@x", 20);
    assert.equal(out.length, 20);
    assert.equal(out[0], "m0@x", "thread root must survive truncation");
    assert.equal(out.at(-1), "newest@x");
  });

  test("formats as angle-bracketed, space separated", () => {
    assert.equal(formatReferencesHeader(["a@x", "b@x"]), "<a@x> <b@x>");
    assert.equal(formatReferencesHeader([]), undefined);
  });
});

describe("plus addressing", () => {
  test("finds the token across any recipient field", () => {
    assert.equal(
      extractConversationToken([null, "Support <support+9f2ac1@help.example.com>"]),
      "9f2ac1",
    );
  });

  test("is case insensitive and normalises to lowercase", () => {
    assert.equal(extractConversationToken(["SUPPORT+AB12CD@help.example.com"]), "ab12cd");
  });

  test("returns null for a plain support address", () => {
    assert.equal(extractConversationToken(["support@help.example.com"]), null);
  });

  test("round-trips with replyToAddress", () => {
    const addr = replyToAddress("deadbeef", "help.example.com");
    assert.equal(addr, "support+deadbeef@help.example.com");
    assert.equal(extractConversationToken([addr]), "deadbeef");
  });
});

describe("subjects", () => {
  test("strips stacked and mixed reply prefixes", () => {
    assert.equal(normalizeSubject("Re: Fwd: RE: Billing question"), "billing question");
  });

  test("handles non-English prefixes", () => {
    assert.equal(normalizeSubject("AW: Rechnung"), "rechnung");
    assert.equal(normalizeSubject("SV: Faktura"), "faktura");
  });

  test("collapses whitespace so wrapped subjects compare equal", () => {
    assert.equal(normalizeSubject("Billing    question\t"), "billing question");
  });

  test("does not double-prefix an outgoing reply", () => {
    assert.equal(replySubject("Re: Billing"), "Re: Billing");
    assert.equal(replySubject("Billing"), "Re: Billing");
    assert.equal(replySubject(""), "Re: (no subject)");
  });
});

describe("resolveThread — layered strategy", () => {
  function resolvers(over: Partial<ThreadResolvers> = {}): ThreadResolvers {
    return {
      byMessageIds: async () => null,
      byToken: async () => null,
      bySubject: async () => null,
      ...over,
    };
  }

  test("prefers headers over everything else", async () => {
    const match = await resolveThread(
      {
        fromEmail: "a@x.com",
        recipients: ["support+tok123@help.example.com"],
        subject: "Re: Billing",
        inReplyTo: "<parent@x>",
        references: null,
      },
      resolvers({
        byMessageIds: async () => ({ conversationId: "conv-headers", messageId: "parent@x" }),
        byToken: async () => "conv-token",
        bySubject: async () => "conv-subject",
      }),
    );
    assert.equal(match.strategy, "headers");
    assert.equal(match.conversationId, "conv-headers");
  });

  test("falls back to the plus-address token when headers miss", async () => {
    const match = await resolveThread(
      {
        fromEmail: "a@x.com",
        recipients: ["support+tok123@help.example.com"],
        subject: "Billing",
        inReplyTo: "<unknown@x>",
        references: null,
      },
      resolvers({ byToken: async () => "conv-token", bySubject: async () => "conv-subject" }),
    );
    assert.equal(match.strategy, "plus-address");
    assert.equal(match.conversationId, "conv-token");
  });

  test("falls back to the subject heuristic last, flagged low confidence", async () => {
    const match = await resolveThread(
      {
        fromEmail: "a@x.com",
        recipients: ["support@help.example.com"],
        subject: "Re: Billing",
        inReplyTo: null,
        references: null,
      },
      resolvers({ bySubject: async () => "conv-subject" }),
    );
    assert.equal(match.strategy, "subject");
    if (match.strategy === "subject") assert.equal(match.confidence, "low");
  });

  test("reports none when every layer misses, so a new conversation is created", async () => {
    const match = await resolveThread(
      {
        fromEmail: "a@x.com",
        recipients: ["support@help.example.com"],
        subject: "Brand new question",
        inReplyTo: null,
        references: null,
      },
      resolvers(),
    );
    assert.equal(match.strategy, "none");
  });

  test("does not attempt the subject heuristic on a trivially short subject", async () => {
    let called = false;
    await resolveThread(
      {
        fromEmail: "a@x.com",
        recipients: ["support@help.example.com"],
        subject: "hi",
        inReplyTo: null,
        references: null,
      },
      resolvers({
        bySubject: async () => {
          called = true;
          return "nope";
        },
      }),
    );
    assert.equal(called, false);
  });

  test("passes the normalised subject to the resolver", async () => {
    let seen = "";
    await resolveThread(
      {
        fromEmail: "A@X.com",
        recipients: [],
        subject: "RE: Fwd: Refund request",
        inReplyTo: null,
        references: null,
      },
      resolvers({
        bySubject: async ({ normalizedSubject, fromEmail }) => {
          seen = `${fromEmail}|${normalizedSubject}`;
          return null;
        },
      }),
    );
    assert.equal(seen, "a@x.com|refund request");
  });
});

describe("quoted history", () => {
  test('cuts at Gmail\'s "On ... wrote:" marker', () => {
    const body = [
      "Thanks, that fixed it!",
      "",
      "On Tue, 3 Jun 2026 at 14:02, Support <support@x.com> wrote:",
      "> Have you tried clearing the cache?",
      "> Let us know.",
    ].join("\n");
    assert.equal(stripQuotedText(body), "Thanks, that fixed it!");
  });

  test("cuts at the Outlook original-message divider", () => {
    const body = "Still broken.\n\n-----Original Message-----\nFrom: Support\nOld text";
    assert.equal(stripQuotedText(body), "Still broken.");
  });

  test("cuts at a run of quoted lines", () => {
    const body = "No luck.\n\n> line one\n> line two\n> line three";
    assert.equal(stripQuotedText(body), "No luck.");
  });

  test("returns the body unchanged when nothing is recognised", () => {
    const body = "Just a normal message with no quoting at all.";
    assert.equal(stripQuotedText(body), body);
  });

  test("fails safe: never returns empty when the marker is at position zero", () => {
    // A top-quoted reply where the marker leads. Trimming would leave nothing,
    // so the original must come back rather than an empty message.
    const body = "On Tue, 3 Jun 2026 at 14:02, Support <s@x.com> wrote:\n> everything";
    assert.equal(stripQuotedText(body), body.trim());
  });

  test("strips the Gmail quote container from HTML", () => {
    const html = '<div>Thanks!</div><div class="gmail_quote">old thread</div>';
    assert.equal(stripQuotedHtml(html), "<div>Thanks!</div>");
  });

  test("HTML stripping fails safe when it would empty the body", () => {
    const html = '<blockquote>only quoted content</blockquote>';
    assert.equal(stripQuotedHtml(html), html);
  });
});

describe("plain text projection", () => {
  test("prefers the text part", () => {
    assert.equal(toPlainText({ text: "hello", html: "<p>ignored</p>" }), "hello");
  });

  test("flattens HTML with block structure preserved as newlines", () => {
    assert.equal(toPlainText({ html: "<p>one</p><p>two</p>" }), "one\ntwo");
  });

  test("decodes entities and drops scripts", () => {
    const out = toPlainText({ html: "<p>a &amp; b</p><script>evil()</script>" });
    assert.equal(out, "a & b");
  });

  test("returns empty string when there is nothing to project", () => {
    assert.equal(toPlainText({}), "");
  });
});
