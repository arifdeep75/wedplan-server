
import {
  USER_ROLES,
  SERVICE_CATEGORIES,
  BOOKING_STATUSES,
  SERVICE_STATUSES,
  SUBSCRIPTION_PLANS,
} from "../constants/index.js";

export type UserRole =
  (typeof USER_ROLES)[keyof typeof USER_ROLES];

export type ServiceCategory =
  (typeof SERVICE_CATEGORIES)[number];

export type BookingStatus =
  (typeof BOOKING_STATUSES)[keyof typeof BOOKING_STATUSES];

export type ServiceStatus =
  (typeof SERVICE_STATUSES)[keyof typeof SERVICE_STATUSES];

export type SubscriptionPlan =
  (typeof SUBSCRIPTION_PLANS)[keyof typeof SUBSCRIPTION_PLANS];
