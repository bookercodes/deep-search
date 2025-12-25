import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
  parts: text("parts", { mode: "json" }).notNull().default([]).$type<unknown[]>(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
