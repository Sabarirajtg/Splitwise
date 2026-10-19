const mongoose = require("mongoose");
const { Schema } = mongoose;

const UserSchema = new Schema({
  _id: { type: String },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  googleId: { type: String, required: true, unique: true },
  avatarUrl: { type: String },
  upiId: { type: String, default: null }
});

const GroupSchema = new Schema({
  _id: { type: String },
  name: { type: String, required: true },
  baseCurrency: { type: String, required: true },
  spendingCurrency: { type: String, default: null },
  memberIds: [{ type: String }],
  createdBy: { type: String },
  simplificationOptOutIds: { type: [String], default: [] },
  inviteToken: { type: String, default: null, index: true },
  inviteExpiresAt: { type: Date, default: null }
}, { timestamps: true });

const SplitSchema = new Schema({
  userId: String,
  amount: Number,
  rawValue: Schema.Types.Mixed
}, { _id: false });

const ExpenseSchema = new Schema({
  _id: { type: String },
  groupId: { type: String, required: true, index: true },
  desc: String,
  amount: Number,
  currency: String,
  amountInBase: Number,
  fxRate: Number,
  fxRates: { type: Schema.Types.Mixed, default: null },
  paidBy: String,
  splits: [SplitSchema],
  date: String,
  recurring: { type: String, default: null }, // 'weekly' | 'monthly' | null
  splitMethod: String,
  lastGenerated: String,
  generatedFrom: { type: String, default: null }
}, { timestamps: true });

const SettlementSchema = new Schema({
  _id: { type: String },
  groupId: { type: String, required: true, index: true },
  from: String,
  to: String,
  amount: Number,
  currency: String,
  date: String,
  status: { type: String, enum: ["pending_confirmation", "reported_problem", "settled"], default: "settled" },
  reportedBy: { type: String, default: null },
  confirmedBy: { type: String, default: null },
  reportedAt: { type: Date, default: null },
  confirmedAt: { type: Date, default: null },
  issueNote: { type: String, default: null }
}, { timestamps: true });

module.exports = {
  User: mongoose.model("User", UserSchema),
  Group: mongoose.model("Group", GroupSchema),
  Expense: mongoose.model("Expense", ExpenseSchema),
  Settlement: mongoose.model("Settlement", SettlementSchema)
};
