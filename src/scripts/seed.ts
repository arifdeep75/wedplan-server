
// Seed script: inserts demo approved services so dynamic sections have data.
// Run with: npm run seed
// Safe to re-run — it skips seeding when approved services already exist.

import "dotenv/config";
import { ObjectId } from "mongodb";
import { connectDB, getDB } from "../config/db.js";

const DEMO_SERVICES = [
  {
    serviceName: "Timeless Wedding Photography",
    category: "Photography & Videography",
    description:
      "Full-day candid and traditional photography coverage with a same-day highlight film.",
    price: 65000,
    location: "Dhaka",
    images: [
      "https://images.unsplash.com/photo-1606216794074-735e91aa2c92?auto=format&fit=crop&w=1000&q=85",
    ],
  },
  {
    serviceName: "The Grand Ballroom Venue",
    category: "Wedding Venues",
    description:
      "An elegant ballroom for 400 guests with stage, lighting, and dedicated bridal suite.",
    price: 250000,
    location: "Dhaka",
    images: [
      "https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&w=1000&q=85",
    ],
  },
  {
    serviceName: "Signature Floral Decoration",
    category: "Decoration & Florist",
    description:
      "Custom stage, gate, and venue decoration with fresh seasonal flowers and draping.",
    price: 85000,
    location: "Chattogram",
    images: [
      "https://images.unsplash.com/photo-1520854221256-17451cc331bf?auto=format&fit=crop&w=1000&q=85",
    ],
  },
  {
    serviceName: "Royal Catering Experience",
    category: "Catering Services",
    description:
      "Traditional and continental menus for up to 500 guests, served by a professional team.",
    price: 120000,
    location: "Dhaka",
    images: [
      "https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?auto=format&fit=crop&w=1000&q=85",
    ],
  },
  {
    serviceName: "Bridal Makeup & Styling",
    category: "Makeup & Styling",
    description:
      "HD bridal makeup, hairstyle, and draping by senior artists, on location.",
    price: 30000,
    location: "Sylhet",
    images: [
      "https://images.unsplash.com/photo-1594736797933-d04079a7e3e1?auto=format&fit=crop&w=1000&q=85",
    ],
  },
  {
    serviceName: "Wedding Fashion Studio",
    category: "Wedding Fashion",
    description:
      "Bespoke bridal lehengas, sherwanis, and family outfits with fitting sessions included.",
    price: 55000,
    location: "Khulna",
    images: [
      "https://images.unsplash.com/photo-1537633552985-df8429e8048b?auto=format&fit=crop&w=1000&q=85",
    ],
  },
];

async function seed() {
  await connectDB();
  const db = getDB();

  const existing = await db
    .collection("services")
    .countDocuments({ status: "approved" });

  if (existing > 0) {
    console.log(
      `Seed skipped — ${existing} approved service(s) already exist.`
    );
    process.exit(0);
  }

  // Use the first registered vendor (Better Auth stores accounts in "user"),
  // or create a minimal demo vendor record
  let vendor = await db.collection("user").findOne({ role: "vendor" });

  if (!vendor) {
    const result = await db.collection("user").insertOne({
      _id: new ObjectId(),
      name: "WedPlan Studio",
      email: "demo.vendor@wedplan.test",
      image: null,
      role: "vendor",
      businessName: "WedPlan Studio",
      isBlocked: false,
      subscriptionPlan: "free",
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    vendor = await db.collection("user").findOne({ _id: result.insertedId });
    console.log("Created demo vendor: demo.vendor@wedplan.test");
  }

  const now = new Date();

  await db.collection("services").insertMany(
    DEMO_SERVICES.map((service, index) => ({
      ...service,
      vendorId: String(vendor!._id),
      status: "approved",
      isActive: true,
      createdAt: new Date(now.getTime() - index * 60_000),
    }))
  );

  console.log(
    `Seeded ${DEMO_SERVICES.length} demo services for vendor "${vendor!.name}".`
  );
  process.exit(0);
}

seed().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
