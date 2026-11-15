#!/usr/bin/env node
/**
 * Live-model evaluation for MIKO interpretation.
 *
 * This command is EXPLICIT and may use your ChatGPT / Codex sign-in (token cost).
 * Deterministic tests (`npm test`) never call the model.
 *
 * Usage:
 *   npm run eval:live
 *
 * It does not train a model, upload conversations, or start a fine-tuning job.
 * See PROJECT_LOG.md and src/shared/eval/dataset.json.
 */
console.log(`MIKO live evaluation
===================
Deterministic baseline: run \`npm test\` (includes src/shared/eval/eval.test.ts).

Live interpretation against ChatGPT/Codex is not automated in this script yet:
wire a controlled, consented run through the existing bridge when you want
measured token use. Do not invent accuracy numbers.

Future fine-tuning path (only if evaluation shows persistent interpretation errors
after context and tooling are fixed):
1. Gather consented, redacted correction examples.
2. Define a narrow intent-to-plan training task.
3. Keep the holdout set in dataset.json untouched.
4. Compare against prompting + retrieval before training.
5. Measure whether improvement justifies cost.

Preferences, aliases, and retrieved examples are not model weights.
`)
process.exit(0)
