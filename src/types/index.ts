import type { ObjectId } from "mongodb";

export type UserRole = "admin" | "vendor" | "customer";

export type ServiceCategory =
  | "Photography & Videography"
  | "Wedding Venues"
  | "Decoration & Florist"
  | "Catering Services"
  | "Makeup & Styling"
  | "Wedding Fashion";

export type ServiceStatus = "pending" | "approved" | "rejected";

export type BookingStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "cancelled";

export type SubscriptionPlan = "free" | "premium";

export type TransactionStatus = "pending" | "paid" | "failed";

export interface Service {
  _id?: ObjectId;
  vendorId: string;
  serviceName: string;
  category: ServiceCategory;
  description: string;
  price: number;
  location: string;
  images: string[];
  status: ServiceStatus;
  isActive: boolean;
  createdAt: Date;
}

export interface Booking {
  _id?: ObjectId;
  serviceId: ObjectId;
  vendorId: string;
  customerId: string;
  eventDate: Date;
  eventLocation: string;
  message: string;
  status: BookingStatus;
  createdAt: Date;
}

export interface Transaction {
  _id?: ObjectId;
  vendorId: string;
  plan: SubscriptionPlan;
  amount: number;
  currency: string;
  stripeSessionId: string;
  stripeSubscriptionId?: string;
  status: TransactionStatus;
  createdAt: Date;
}