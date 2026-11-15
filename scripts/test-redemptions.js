// End-to-end check of gift-card redemptions on Solana devnet (D-032): node scripts/test-redemptions.js
// Uses a throwaway zz-test- user with no location (so it is never asked anything) and deletes it at the end.
// Successful redemptions send real devnet memo transactions; failures are simulated by swapping the chain functions.
import { createPrivateKey, sign as edSign } from "node:crypto";
import { Connection, Keypair } from "@solana/web3.js";
import { env } from "../src/config.js";
import { connectMongo, col } from "../src/db/mongo.js";
import * as mongo from "../src/db/mongo.js";
import * as R from "../src/pay/redemptions.js";
import { newWallet, treasuryInfo } from "../src/pay/solana.js";

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
const credits = async (id) => (await mongo.getUser(id)).credits;
const key = () => `k${Math.random().toString(36).slice(2, 12)}`;
const real = { ...R._chainForTests };
const restore = () => Object.assign(R._chainForTests, real);

await connectMongo();
const info = await treasuryInfo();
if (!info) { console.log("SOLANA_TREASURY_SECRET is not set; can't run."); process.exit(1); }
console.log(`Treasury ${info.pub} has ${info.balance} devnet SOL`);

const uid = `zz-test-redeem-${Date.now()}`;
await col("users").insertOne({ _id: uid, name: "zz-test redeem", channel: "dev", channelUserId: uid, credits: 120, trust: 1, wallet: newWallet(), createdAt: new Date() });

try {
  // 1. Not enough points: nothing is taken, nothing is recorded.
  let r = await R.redeem(uid, { rewardId: "devils25", idemKey: key() });
  check("insufficient points is refused", !r.ok && r.code === "insufficient", r.message);
  check("insufficient points takes nothing", (await credits(uid)) === 120);

  // 2. Double tap: the same request key sent twice at once makes one redemption and takes points once.
  const k = key();
  const [a, b] = await Promise.all([R.redeem(uid, { rewardId: "coffee5", idemKey: k }), R.redeem(uid, { rewardId: "coffee5", idemKey: k })]);
  const ids = new Set([a.redemption?.id, b.redemption?.id]);
  check("double tap makes one redemption", ids.size === 1 && (await col("redemptions").countDocuments({ userId: uid, idemKey: k })) === 1);
  check("double tap takes points once", (await credits(uid)) === 70, `credits ${await credits(uid)}`);
  let done = await mongo.getRedemption([...ids][0]);
  check("success: confirmed on devnet, awaiting fulfillment", done.status === "awaiting_fulfillment" && Boolean(done.signature) && Boolean(done.confirmedAt), done.signature);

  // The memo on chain holds only the opaque ID.
  const conn = new Connection(env.solanaRpc, "confirmed");
  const tx = await conn.getTransaction(done.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  const memoLog = (tx?.meta?.logMessages || []).find((l) => l.startsWith("Program log: Memo")) || "";
  check("memo holds only the opaque redemption ID", memoLog.includes(`oracle:redemption:v1:${done._id}`) && !memoLog.includes("zz-test") && !/starbucks|amazon/i.test(memoLog), memoLog.slice(0, 90));
  console.log(`      Explorer: https://explorer.solana.com/tx/${done.signature}?cluster=devnet`);

  // 3. Two different taps racing for more than the balance: only what the balance covers goes through.
  const [c, d] = await Promise.all([R.redeem(uid, { rewardId: "coffee5", idemKey: key() }), R.redeem(uid, { rewardId: "coffee5", idemKey: key() })]);
  check("racing redemptions can't overspend", [c, d].filter((x) => x.ok).length === 1 && (await credits(uid)) === 20, `credits ${await credits(uid)}`);

  // 4. Transaction failure: points stay held, nothing is double-taken; retry records it once.
  await col("users").updateOne({ _id: uid }, { $inc: { credits: 100 } });   // 120
  Object.assign(R._chainForTests, { send: async () => { throw new Error("simulated RPC outage"); }, state: async () => "expired" });
  r = await R.redeem(uid, { rewardId: "amazon10", idemKey: key() });
  check("failed transaction is reported as failed", r.ok && r.redemption.status === "failed" && r.redemption.canRetry, r.redemption.error);
  check("failed transaction holds the points (taken once)", (await credits(uid)) === 20, `credits ${await credits(uid)}`);
  // Two retries at once: the old transaction can't land (expired), only one new transaction is sent.
  Object.assign(R._chainForTests, { send: real.send, state: async () => "expired" });
  const [r1, r2] = await Promise.all([R.retry(uid, r.redemption.id), R.retry(uid, r.redemption.id)]);
  restore();
  done = await mongo.getRedemption(r.redemption.id);
  check("retry confirms on devnet", done.status === "awaiting_fulfillment" && (r1.ok || r2.ok), done.signature);
  check("simultaneous retries send one new transaction", done.attempts.length === 2, `${done.attempts.length} attempts`);
  check("retry never takes points again", (await credits(uid)) === 20, `credits ${await credits(uid)}`);

  // 5. Failure, then cancel: points come back exactly once.
  await col("users").updateOne({ _id: uid }, { $inc: { credits: 30 } });   // 50
  Object.assign(R._chainForTests, { send: async () => { throw new Error("simulated RPC outage"); }, state: async () => "expired" });
  r = await R.redeem(uid, { rewardId: "coffee5", idemKey: key() });
  const [x1, x2] = await Promise.all([R.cancel(uid, r.redemption.id), R.cancel(uid, r.redemption.id)]);
  restore();
  check("cancel refunds once", (await credits(uid)) === 50 && [x1, x2].filter((x) => x.ok).length === 1, `credits ${await credits(uid)}`);
  check("cancelled redemption can't be retried", !(await R.retry(uid, r.redemption.id)).redemption?.canRetry);

  // 6. Interrupted after sending: the reconciler finds the landed transaction instead of sending another.
  Object.assign(R._chainForTests, { confirm: async () => { throw new Error("simulated timeout"); }, state: async () => "pending" });
  r = await R.redeem(uid, { rewardId: "coffee5", idemKey: key() });   // 50 → 0
  check("timeout after sending stays pending", r.redemption.status === "pending");
  restore();
  await new Promise((res) => setTimeout(res, 3000));
  await R.reconcile();
  done = await mongo.getRedemption(r.redemption.id);
  check("reconciler confirms the landed transaction", done.status === "awaiting_fulfillment" && done.attempts.length === 1);

  // 7. Wallet ownership by signed challenge, then redeem with the verified wallet.
  const kp = Keypair.generate(), address = kp.publicKey.toBase58();
  const { message } = await R.walletChallenge({ _id: uid }, address);
  const priv = createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", d: Buffer.from(kp.secretKey.slice(0, 32)).toString("base64url"), x: Buffer.from(kp.publicKey.toBytes()).toString("base64url") }, format: "jwk" });
  const goodSig = edSign(null, Buffer.from(message, "utf8"), priv).toString("base64");
  const forged = edSign(null, Buffer.from(message + "x", "utf8"), priv).toString("base64");
  let bad = ""; try { await R.verifyWallet({ _id: uid }, address, forged); } catch (e) { bad = e.message; }
  check("a wrong signature is rejected", /doesn't match/.test(bad), bad);
  const ok = await R.verifyWallet({ _id: uid }, address, goodSig);
  check("a correct signature verifies the wallet", ok.ok && R.hasVerifiedWallet(await mongo.getUser(uid)));
  await col("users").updateOne({ _id: uid }, { $inc: { credits: 50 } });
  r = await R.redeem(uid, { rewardId: "coffee5", idemKey: key(), payout: "verified" });
  check("redeem with the verified wallet", r.redemption?.status === "awaiting_fulfillment" && r.redemption.wallet.kind === "verified");
} finally {
  restore();
  await col("redemptions").deleteMany({ userId: uid });
  await col("users").deleteOne({ _id: uid });
  console.log("Cleaned up the zz-test user and its redemptions.");
}
const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
