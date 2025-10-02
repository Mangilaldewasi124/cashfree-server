// showSplit.js
const admin = require("firebase-admin");
const fs = require("fs");

const KEY_PATH = "./serviceAccountKey.json";
if (!fs.existsSync(KEY_PATH)) {
  console.error("Put your serviceAccountKey.json at", KEY_PATH);
  process.exit(1);
}
const serviceAccount = require(KEY_PATH);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

const splitId = process.argv[2];
if (!splitId) {
  console.error("Usage: node showSplit.js <SPLIT_ID>");
  process.exit(1);
}

(async () => {
  try {
    const doc = await db.collection("splits").doc(splitId).get();
    if (!doc.exists) {
      console.log("No split doc found for id:", splitId);
      process.exit(0);
    }
    console.log("Split doc:", JSON.stringify({ id: doc.id, ...doc.data() }, null, 2));
  } catch (err) {
    console.error("Error reading split:", err);
  } finally {
    process.exit(0);
  }
})();
