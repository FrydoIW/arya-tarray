import { Router } from "express";
import { accountingRouter } from "../modules/accounting/accounting.routes.js";
import { memberRegistrationRouter } from "../modules/member/registration/member-registration.routes.js";
import { memberDataRouter } from "../modules/member/data/member-data.routes.js";
import { SIGN_APPROVAL_MENU_CODE } from "../constants/approval.js";
import { requireMenuAccess } from "../middleware/authorization.js";
import { signApprovalRouter } from "../modules/approval/sign-approval/sign-approval.routes.js";
import { dashboardRouter } from "../modules/monitoring/dashboard/dashboard.routes.js";
import { timeBasedMonitoringRouter } from "../modules/monitoring/time-based/time-based-monitoring.routes.js";
import { campaignMonitoringRouter } from "../modules/monitoring/campaign/campaign-monitoring.routes.js";
import { statementUploadRouter } from "../modules/reconciliation/statement-upload/statement-upload.routes.js";
import { editIncomeRouter } from "../modules/reconciliation/edit-income/edit-income.routes.js";
import { transactionInquiryRouter } from "../modules/reconciliation/transaction-inquiry/transaction-inquiry.routes.js";
import { approvalRouter } from "../modules/configuration/approval/approval.routes.js";
import { bankAccountRouter } from "../modules/configuration/bank-account/bank-account.routes.js";
import { eventCodeRouter } from "../modules/configuration/event-code/event-code.routes.js";
import { roleRouter } from "../modules/configuration/role/role.routes.js";
import { userRouter } from "../modules/configuration/user/user.routes.js";

export const apiRouter = Router();
apiRouter.use("/accounting", requireMenuAccess("ACCOUNTING_REPORT"), accountingRouter);
apiRouter.use("/member/registration", requireMenuAccess("MEMBER_REGISTRATION"), memberRegistrationRouter);
apiRouter.use("/member/data", requireMenuAccess("MEMBER_DATA"), memberDataRouter);

apiRouter.use(
  "/monitoring/dashboard",
  requireMenuAccess("MONITORING_DASHBOARD"),
  dashboardRouter
);
apiRouter.use("/monitoring/time-based", requireMenuAccess("MONITORING_TIME_BASED"), timeBasedMonitoringRouter);
apiRouter.use("/monitoring/campaign", requireMenuAccess("MONITORING_CAMPAIGN"), campaignMonitoringRouter);

apiRouter.use(
  "/configuration/event-codes",
  requireMenuAccess("CONFIG_EVENT_CODE"),
  eventCodeRouter
);

apiRouter.use(
  "/configuration/roles",
  requireMenuAccess("CONFIG_ROLE"),
  roleRouter
);

apiRouter.use(
  "/configuration/users",
  requireMenuAccess("CONFIG_USER"),
  userRouter
);

apiRouter.use(
  "/configuration/approvals",
  requireMenuAccess("CONFIG_APPROVAL"),
  approvalRouter
);

apiRouter.use(
  "/configuration/bank-accounts",
  requireMenuAccess("CONFIG_BANK_ACCOUNT"),
  bankAccountRouter
);

apiRouter.use(
  "/reconciliation/statement-upload",
  requireMenuAccess("RECON_STATEMENT_UPLOAD"),
  statementUploadRouter
);

apiRouter.use(
  "/reconciliation/edit-income",
  requireMenuAccess("RECON_EDIT_INCOME"),
  editIncomeRouter
);

apiRouter.use(
  "/reconciliation/transaction-inquiry",
  requireMenuAccess("RECON_TRANSACTION_INQUIRY"),
  transactionInquiryRouter
);

apiRouter.use(
  "/approval/sign",
  requireMenuAccess(SIGN_APPROVAL_MENU_CODE),
  signApprovalRouter
);
