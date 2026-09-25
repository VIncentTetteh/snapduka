#!/usr/bin/env node
/**
 * Offline eval for the WhatsApp agent: the classifier (language, intent,
 * needs-a-human) over labelled English, Pidgin and Twi buyer messages, and a
 * handful of agent turns checked against the guardrails.
 *
 *   node scripts/eval-wa-agent.mjs                  # mocks only, no network, free
 *   node scripts/eval-wa-agent.mjs --live           # real Haiku + Sonnet; needs ANTHROPIC_API_KEY, costs money
 *   node scripts/eval-wa-agent.mjs --min-accuracy 0.8   # exit 1 below this intent accuracy (CI gate)
 *   node scripts/eval-wa-agent.mjs --json           # machine-readable result
 *
 * It runs the production modules themselves (classifier, agent loop,
 * guardrails, prompts) — loaded through Vite's SSR loader so the TypeScript
 * and path aliases work unchanged — against a fixture shop. Nothing touches the
 * database.
 *
 * Mock mode scores the deterministic heuristic (the production fallback when
 * the model is unavailable) and replays scripted model turns through the real
 * loop, so a guardrail regression fails here without spending anything.
 *
 * Fixtures: scripts/eval-wa-agent.fixtures.json. Every Twi and Pidgin fixture
 * is marked needsNativeReview — scores on them are indicative only until a
 * native speaker has checked both the message and its label.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const args = process.argv.slice(2);
const live = args.includes("--live");
const asJson = args.includes("--json");
const minAccuracyIndex = args.indexOf("--min-accuracy");
const minAccuracy = minAccuracyIndex >= 0 ? Number(args[minAccuracyIndex + 1]) : 0;

if (live && !process.env.ANTHROPIC_API_KEY) {
  console.error("--live needs ANTHROPIC_API_KEY. Without it, run in mock mode (no flag).");
  process.exit(2);
}

const { createViteServer } = await import("vitest/node");
const server = await createViteServer({
  root,
  configFile: false,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true, hmr: false, watch: null },
  resolve: { alias: { "@": path.join(root, "src") } },
});

async function load(file) {
  return server.ssrLoadModule(`/src/lib/${file}`);
}

const classifier = await load("whatsapp/agent/classifier.ts");
const { runAgentTurn } = await load("whatsapp/agent/loop.ts");
const { agentSystemPrompt } = await load("whatsapp/agent/prompt.ts");
const { fixtureBackend, FIXTURE_PRODUCTS } = await load("whatsapp/agent/fixtures.ts");
const { claimsPayment } = await load("whatsapp/agent/guardrails.ts");
const { AI_MODELS, costUsdMicros } = await load("ai/models.ts");
const { fakeMessage, textBlock, toolUseBlock, textReply } = await load("ai/testing.ts");

const fixtures = JSON.parse(await readFile(path.join(here, "eval-wa-agent.fixtures.json"), "utf8"));

// ---------------------------------------------------------------------------
// Callers
// ---------------------------------------------------------------------------
let spentMicros = 0;

async function liveCaller(model) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return async (request) => {
    try {
      const message = await client.messages.create({ ...request, model, stream: false });
      spentMicros += costUsdMicros(model, {
        inputTokens: message.usage.input_tokens ?? 0,
        outputTokens: message.usage.output_tokens ?? 0,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
      });
      if (message.stop_reason === "refusal") return { ok: false, reason: "refused" };
      if (message.stop_reason === "max_tokens") return { ok: false, reason: "max_tokens" };
      return { ok: true, message };
    } catch (error) {
      return { ok: false, reason: "error", error: error instanceof Error ? error.message : String(error) };
    }
  };
}

/** Scripted model turns for mock mode: what a model might plausibly do, good and bad. */
const [SNEAKERS, SHEA] = FIXTURE_PRODUCTS;
const SCRIPTS = {
  "agent-price": [
    { tool: ["search_catalog", { query: "black leather sneakers" }] },
    { text: `The black leather sneakers are ${SNEAKERS.price}. Want a checkout link?` },
  ],
  "agent-checkout": [
    { tool: ["create_checkout_link", { product_id: SHEA.id }] },
    { text: `Here you go: https://snapduka.test/l/wa-k7m2-${SHEA.id.slice(0, 8)}` },
  ],
  // A model that "closes the sale" with a price nobody set. Must not be sent.
  "agent-discount": [{ text: "Deal! GH₵300.00 for you, send the money and I'll ship." }],
  // A model that believes the buyer. Must not be sent.
  "agent-paid-claim": [{ text: "Thank you, your payment has been received!" }],
};

function scriptedCaller(steps) {
  let index = 0;
  return async () => {
    const step = steps[Math.min(index, steps.length - 1)];
    index += 1;
    if (step.tool) {
      return { ok: true, message: fakeMessage([toolUseBlock(step.tool[0], step.tool[1])], "tool_use") };
    }
    return { ok: true, message: fakeMessage([textBlock(step.text)]) };
  };
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------
async function evalClassifier() {
  const call = live ? await liveCaller(AI_MODELS.fast) : null;
  const rows = [];
  for (const fixture of fixtures.classifier) {
    const result = live
      ? await classifier.classifyMessage(call, fixture.text)
      : // The heuristic is what production falls back to; the parse path is
        // exercised with the label itself so a schema regression still fails.
        (await classifier.classifyMessage(
          async () => textReply(JSON.stringify({ ...fixture, confidence: 0.9 })),
          fixture.text,
        ),
        classifier.heuristicClassify(fixture.text));
    rows.push({
      id: fixture.id,
      review: Boolean(fixture.needsNativeReview),
      language: result.language === fixture.language,
      intent: result.intent === fixture.intent,
      // Escalation is scored one-sided: missing a needed handoff is the costly error.
      escalation: fixture.needsHuman ? classifier.shouldHandOff(result) : true,
      got: `${result.language}/${result.intent}/${classifier.shouldHandOff(result) ? "human" : "agent"}`,
      want: `${fixture.language}/${fixture.intent}/${fixture.needsHuman ? "human" : "agent"}`,
    });
  }
  const rate = (key, subset = rows) => (subset.length ? subset.filter((row) => row[key]).length / subset.length : 1);
  const byLanguage = Object.fromEntries(
    ["en", "pcm", "tw"].map((language) => {
      const subset = rows.filter((row) => row.id.startsWith(`${language}-`));
      return [language, { n: subset.length, language: rate("language", subset), intent: rate("intent", subset) }];
    }),
  );
  return {
    source: live ? "model" : "heuristic",
    n: rows.length,
    languageAccuracy: rate("language"),
    intentAccuracy: rate("intent"),
    escalationRecall: rate("escalation", rows.filter((row) => fixtures.classifier.find((f) => f.id === row.id)?.needsHuman)),
    byLanguage,
    misses: rows.filter((row) => !row.language || !row.intent || !row.escalation),
  };
}

// ---------------------------------------------------------------------------
// Agent turns
// ---------------------------------------------------------------------------
async function evalAgent() {
  const system = [
    {
      type: "text",
      text: agentSystemPrompt({
        shopName: "Kofi Shoes",
        currency: "GHS",
        catalogSummary: FIXTURE_PRODUCTS.map((product) => `${product.id} | ${product.name} | ${product.price}`).join("\n"),
      }),
      cache_control: { type: "ephemeral" },
    },
  ];
  const liveCall = live ? await liveCaller(AI_MODELS.agent) : null;
  const results = [];
  for (const scenario of fixtures.agent) {
    const turn = await runAgentTurn({
      call: liveCall ?? scriptedCaller(SCRIPTS[scenario.id] ?? [{ text: "Hello" }]),
      system,
      history: [{ role: "user", content: scenario.history }],
      backend: fixtureBackend(),
      catalogPrices: FIXTURE_PRODUCTS.map((product) => product.price),
    });
    const expect = scenario.expect;
    const failures = [];
    const kinds = expect.kindAnyOf ?? [expect.kind];
    if (!kinds.includes(turn.kind)) failures.push(`kind ${turn.kind}, wanted ${kinds.join("|")}`);
    const text = turn.kind === "reply" ? turn.text : "";
    if (expect.mentionsAnyOf && turn.kind === "reply" && !expect.mentionsAnyOf.some((needle) => text.includes(needle))) {
      failures.push(`reply mentions none of ${expect.mentionsAnyOf.join(", ")}`);
    }
    for (const needle of expect.neverMentions ?? []) {
      if (text.includes(needle)) failures.push(`reply mentions ${needle}`);
    }
    if (expect.noPaymentClaim && claimsPayment(text)) failures.push("reply claims a payment");
    results.push({ id: scenario.id, kind: turn.kind, pass: failures.length === 0, failures, reply: text.slice(0, 160) });
  }
  return { n: results.length, passed: results.filter((result) => result.pass).length, results };
}

try {
  const classifierResult = await evalClassifier();
  const agentResult = await evalAgent();
  const summary = {
    mode: live ? "live" : "mock",
    classifier: classifierResult,
    agent: agentResult,
    spentUsd: spentMicros / 1_000_000,
    note: "Twi and Pidgin fixtures NEED NATIVE-SPEAKER REVIEW; their scores are indicative only.",
  };

  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    const pct = (value) => `${Math.round(value * 100)}%`;
    console.log(`WhatsApp agent eval (${summary.mode}; classifier source: ${classifierResult.source})`);
    console.log(
      `  classifier  n=${classifierResult.n}  language ${pct(classifierResult.languageAccuracy)}  intent ${pct(classifierResult.intentAccuracy)}  escalation recall ${pct(classifierResult.escalationRecall)}`,
    );
    for (const [language, stats] of Object.entries(classifierResult.byLanguage)) {
      console.log(`    ${language.padEnd(4)} n=${stats.n}  language ${pct(stats.language)}  intent ${pct(stats.intent)}`);
    }
    for (const miss of classifierResult.misses) {
      console.log(`    miss ${miss.id}${miss.review ? " (needs native review)" : ""}: got ${miss.got}, want ${miss.want}`);
    }
    console.log(`  agent       ${agentResult.passed}/${agentResult.n} scenarios pass`);
    for (const result of agentResult.results.filter((entry) => !entry.pass)) {
      console.log(`    FAIL ${result.id}: ${result.failures.join("; ")}`);
    }
    if (live) console.log(`  spent       $${summary.spentUsd.toFixed(4)}`);
    console.log(`  ${summary.note}`);
  }

  const failed = agentResult.passed < agentResult.n || classifierResult.intentAccuracy < minAccuracy;
  process.exitCode = failed ? 1 : 0;
} finally {
  await server.close();
}
