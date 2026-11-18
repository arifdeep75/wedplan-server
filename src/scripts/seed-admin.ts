// Creates or repairs an admin account — the only supported way to make an
// admin (public admin sign-up is permanently blocked by the auth hooks).
//
// Usage:
//   npm run seed:admin -- --email admin@wedplan.test --password <strong-password>
//   or set ADMIN_EMAIL / ADMIN_PASSWORD in .env
//
// If the account already exists it is only upgraded to role=admin (never
// downgraded, never deleted).

import "dotenv/config";
import { connectDB, getDB } from "../config/db.js";
import { createAuth } from "../lib/auth.js";

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const index = args.indexOf(flag);

    return index >= 0 ? args[index + 1] : undefined;
  };

  return {
    email: get("--email") ?? process.env.ADMIN_EMAIL,
    password: get("--password") ?? process.env.ADMIN_PASSWORD,
  };
}

async function seedAdmin() {
  const { email, password } = parseArgs();

  if (!email || !password) {
    console.error(
      "Missing admin credentials. Pass --email and --password or set ADMIN_EMAIL / ADMIN_PASSWORD."
    );

    process.exit(1);
  }

  if (password.length < 8) {
    console.error("Admin password must be at least 8 characters.");

    process.exit(1);
  }

  await connectDB();
  const db = getDB();

  // Better Auth stores accounts in the singular "user" collection
  const existing = await db.collection("user").findOne({ email });

  if (existing) {
    if (existing.role === "admin") {
      console.log(`Admin already exists: ${email}`);

      process.exit(0);
    }

    await db
      .collection("user")
      .updateOne(
        { _id: existing._id },
        { $set: { role: "admin", isBlocked: false, updatedAt: new Date() } }
      );

    console.log(`Upgraded existing account to admin: ${email}`);

    process.exit(0);
  }

  // Create the account through Better Auth so the password is hashed
  // correctly, then force the admin role in the database.
  const auth = createAuth();

  try {
    await auth.api.signUpEmail({
      body: {
        name: process.env.ADMIN_NAME ?? "WedPlan Admin",
        email,
        password,
      },
    });

    await db
      .collection("user")
      .updateOne(
        { email },
        { $set: { role: "admin", isBlocked: false, updatedAt: new Date() } }
      );

    console.log(`Admin created: ${email}`);

    process.exit(0);
  } catch (error) {
    console.error("Failed to create admin account:", error);

    process.exit(1);
  }
}

seedAdmin();
