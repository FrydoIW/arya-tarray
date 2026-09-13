"use client";

import { useMemo } from "react";
import { Eye, PencilLine, RefreshCw } from "lucide-react";
import {
  AccessMatrix,
  type AccessMatrixColumn,
  type AccessMatrixGroup
} from "@/components/ui/AccessMatrix";
import { Button } from "@/components/ui/Button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import type { MatrixMode, MenuRegistryItem, Role } from "../types";
import styles from "../styles/role.module.css";

type RoleAccessMatrixProps = {
  roles: Role[];
  menus: MenuRegistryItem[];
  mode: MatrixMode;
  loading: boolean;
  disabled: boolean;
  onModeChange: (mode: MatrixMode) => void;
  hasAccess: (roleId: string, menuId: string) => boolean;
  onToggle: (roleId: string, menuId: string) => void;
  onReload: () => void;
};

export function RoleAccessMatrix({
  roles,
  menus,
  mode,
  loading,
  disabled,
  onModeChange,
  hasAccess,
  onToggle,
  onReload
}: RoleAccessMatrixProps) {
  const columns = useMemo<AccessMatrixColumn[]>(() => roles
    .filter((role) => !role.isDraft)
    .map((role) => ({
      id: role.id,
      label: role.roleCode,
      description: role.roleName,
      active: role.activeFlag
    })), [roles]);

  const groups = useMemo<AccessMatrixGroup[]>(() => {
    const persisted = menus.filter((menu) => !menu.isDraft);
    const pageMenus = persisted.filter((menu) => menu.menuType === "PAGE");
    const groupsById = new Map(persisted.filter((menu) => menu.menuType === "GROUP").map((menu) => [menu.id, menu]));
    const buckets = new Map<string, AccessMatrixGroup>();

    for (const page of pageMenus) {
      const parent = page.parentMenuId ? groupsById.get(page.parentMenuId) : undefined;
      const groupId = parent?.id ?? "ungrouped";
      const existing = buckets.get(groupId) ?? {
        id: groupId,
        label: parent?.menuName ?? "Ungrouped",
        rows: []
      };
      existing.rows.push({
        id: page.id,
        label: page.menuName,
        description: page.route ?? undefined,
        active: page.activeFlag
      });
      buckets.set(groupId, existing);
    }

    return [...buckets.values()].map((group) => ({
      ...group,
      rows: group.rows.sort((a, b) => {
        const menuA = pageMenus.find((menu) => menu.id === a.id);
        const menuB = pageMenus.find((menu) => menu.id === b.id);
        return (menuA?.displayOrder ?? 0) - (menuB?.displayOrder ?? 0) || a.label.localeCompare(b.label);
      })
    })).sort((a, b) => {
      const groupA = persisted.find((menu) => menu.id === a.id);
      const groupB = persisted.find((menu) => menu.id === b.id);
      return (groupA?.displayOrder ?? 9999) - (groupB?.displayOrder ?? 9999) || a.label.localeCompare(b.label);
    });
  }, [menus]);

  return (
    <CollapsibleSection
      className={styles.matrixPanel}
      title="Role Access Matrix"
      description="Inquiry shows the current working access. Use Edit Access to stage checkbox changes, then press Execute at the top of the page."
      summary={`${columns.length} roles`}
      defaultExpanded={false}
      actions={<div className={styles.matrixActions}>
          <Button
            type="button"
            variant={mode === "INQUIRY" ? "primary" : "secondary"}
            size="sm"
            icon={<Eye size={15} />}
            onClick={() => onModeChange("INQUIRY")}
            disabled={disabled}
          >
            Inquiry
          </Button>
          <Button
            type="button"
            variant={mode === "EDIT" ? "primary" : "secondary"}
            size="sm"
            icon={<PencilLine size={15} />}
            onClick={() => onModeChange("EDIT")}
            disabled={disabled}
          >
            Edit Access
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            icon={<RefreshCw size={15} />}
            onClick={onReload}
            disabled={loading || disabled}
            title="Reload latest Role workspace from database. Unsaved changes will be discarded."
          >
            Reload
          </Button>
        </div>}
    >

      <AccessMatrix
        columns={columns}
        groups={groups}
        editable={mode === "EDIT"}
        disabled={disabled}
        loading={loading}
        minWidth={`${Math.max(900, 300 + columns.length * 150)}px`}
        cornerHeader="Menu / Feature"
        hasAccess={(roleId, menuId) => hasAccess(roleId, menuId)}
        onToggle={(roleId, menuId) => onToggle(roleId, menuId)}
        emptyState={{
          title: "Access Matrix is empty",
          description: "Register at least one PAGE menu in Menu Registry and Execute it first. Persisted Roles will appear as matrix columns."
        }}
      />
    </CollapsibleSection>
  );
}
