# Arya Tarray Backend API

Base URL: `/api`

## Auth

- `POST /auth/login`
- `GET /auth/me`

## Configuration - Event Code

- `GET /configuration/event-codes`
- `POST /configuration/event-codes/execute`

Event Code writes are staged in the frontend and committed only through `execute`.

## Configuration - Role

### Lightweight Role list

- `GET /configuration/roles`

Used by other configuration features that only need the Role master list.

### Role workspace

- `GET /configuration/roles/workspace`

Returns:

- Role Master
- Menu Registry
- Role/Menu assignments for the Access Matrix

### Execute Role workspace

- `POST /configuration/roles/workspace/execute`

Commits staged Role Master, Menu Registry, and optional Role Access Matrix changes in one Prisma transaction.

Example shape:

```json
{
  "roles": {
    "creates": [],
    "updates": [],
    "deletes": []
  },
  "menus": {
    "creates": [],
    "updates": [],
    "deletes": []
  },
  "roleMenus": [
    { "roleId": "...", "menuId": "..." }
  ]
}
```

`roleMenus` can be omitted when access assignments were not edited.

## Database baseline

The Role workspace expects these existing tables:

- `arya_role`
- `arya_user`
- `arya_user_role`
- `arya_menu`
- `arya_role_menu`

Menu seed data is intentionally not included yet. Menu Registry can be populated from the UI or seeded later.

## Configuration - User

### User workspace

- `GET /configuration/users/workspace`

Returns User Master rows plus Role options used by the User page.

### Execute User workspace

- `POST /configuration/users/workspace/execute`

Commits new users, user edits/role assignment changes, and staged password resets in one Prisma transaction. Persisted users are not hard-deleted; deactivate them through `status = INACTIVE`.

Example shape:

```json
{
  "creates": [
    {
      "clientId": "draft-...",
      "fullName": "Reconciliation Operator",
      "email": "operator@aryatarray.local",
      "password": "temporary-password",
      "roleId": "...",
      "status": "ACTIVE"
    }
  ],
  "updates": [],
  "passwordResets": []
}
```

## Authorization hardening

Authenticated API requests also require an ACTIVE user. Configuration routes enforce the corresponding Menu Registry permission:

- Event Code: `CONFIG_EVENT_CODE`
- Role: `CONFIG_ROLE`
- User: `CONFIG_USER`

Inactive roles cannot be newly assigned to users. Existing users may retain an already-assigned inactive role while their non-authorization data is repaired. User editing remains single-role in V1; a user with multiple stored role assignments is protected from role-destructive edits.
