import assert from "node:assert/strict";
import test from "node:test";
import {
  hasAdministrativeRecoveryAccess,
  shouldRejectAdministrativeAccessLoss,
  type AdminAccessSnapshotUser
} from "../src/modules/configuration/admin-access-guard.js";

function user(options: {
  status?: string;
  roles: Array<{
    active?: boolean;
    menus: Array<{ code: string; active?: boolean; type?: string }>;
  }>;
}): AdminAccessSnapshotUser {
  return {
    status: options.status ?? "ACTIVE",
    userRoles: options.roles.map((role) => ({
      role: {
        activeFlag: role.active ?? true,
        roleMenus: role.menus.map((menu) => ({
          menu: {
            menuCode: menu.code,
            menuType: menu.type ?? "PAGE",
            activeFlag: menu.active ?? true
          }
        }))
      }
    }))
  };
}

test("admin recovery access accepts CONFIG_ROLE and CONFIG_USER on one active role", () => {
  assert.equal(hasAdministrativeRecoveryAccess([
    user({ roles: [{ menus: [{ code: "CONFIG_ROLE" }, { code: "CONFIG_USER" }] }] })
  ]), true);
});

test("admin recovery access may be composed from multiple active roles", () => {
  assert.equal(hasAdministrativeRecoveryAccess([
    user({ roles: [
      { menus: [{ code: "CONFIG_ROLE" }] },
      { menus: [{ code: "CONFIG_USER" }] }
    ] })
  ]), true);
});

test("inactive user, role, menu, and non-page menu do not count as recovery access", () => {
  assert.equal(hasAdministrativeRecoveryAccess([
    user({ status: "INACTIVE", roles: [{ menus: [{ code: "CONFIG_ROLE" }, { code: "CONFIG_USER" }] }] })
  ]), false);

  assert.equal(hasAdministrativeRecoveryAccess([
    user({ roles: [{ active: false, menus: [{ code: "CONFIG_ROLE" }, { code: "CONFIG_USER" }] }] })
  ]), false);

  assert.equal(hasAdministrativeRecoveryAccess([
    user({ roles: [{ menus: [{ code: "CONFIG_ROLE" }, { code: "CONFIG_USER", active: false }] }] })
  ]), false);

  assert.equal(hasAdministrativeRecoveryAccess([
    user({ roles: [{ menus: [{ code: "CONFIG_ROLE" }, { code: "CONFIG_USER", type: "GROUP" }] }] })
  ]), false);
});

test("guard only rejects losing an already-established recovery path", () => {
  assert.equal(shouldRejectAdministrativeAccessLoss(true, false), true);
  assert.equal(shouldRejectAdministrativeAccessLoss(true, true), false);
  assert.equal(shouldRejectAdministrativeAccessLoss(false, false), false);
  assert.equal(shouldRejectAdministrativeAccessLoss(false, true), false);
});
