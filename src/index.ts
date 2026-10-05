import type { Core } from "@strapi/strapi";

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/* { strapi }: { strapi: Core.Strapi } */) {
    if (process.env.NODE_ENV !== "production") {
      return;
    }

    const required = [
      "APP_KEYS",
      "API_TOKEN_SALT",
      "ADMIN_JWT_SECRET",
      "TRANSFER_TOKEN_SALT",
      "JWT_SECRET",
      "ENCRYPTION_KEY",
      "FRONTEND_URL",
      "CLD_CLOUD_NAME",
      "CLD_API_KEY",
      "CLD_API_SECRET",
      "FLUTTERWAVE_SECRET_KEY",
      "FLUTTERWAVE_WEBHOOK_SECRET",
    ];

    if (process.env.DATABASE_CLIENT === "postgres") {
      required.push("DATABASE_URL");
    }

    const missing = required.filter((name) => !process.env[name]);
    if (missing.length > 0) {
      throw new Error(
        `Missing required production environment variables: ${missing.join(", ")}`,
      );
    }
  },

};
