USE arya_tarray;

-- Safe bootstrap helper.
-- Existing users are NEVER reactivated and their password/name are NEVER overwritten.
-- To create the first admin user, replace NULL below with a freshly generated bcrypt
-- hash, execute this script once, then remove the hash from your SQL client history.
SET @admin_email = 'admin@aryatarray.local';
SET @admin_full_name = 'Arya Tarray Admin';
SET @new_admin_password_hash = NULL;

SET @admin_user_id = (
    SELECT user_id
    FROM arya_user
    WHERE email = @admin_email
    LIMIT 1
);

SET @bootstrap_allowed = IF(
    @admin_user_id IS NOT NULL
    OR (
        @new_admin_password_hash IS NOT NULL
        AND @new_admin_password_hash LIKE '$2%'
        AND CHAR_LENGTH(@new_admin_password_hash) >= 50
    ),
    1,
    0
);

SET @admin_role_id = (
    SELECT role_id
    FROM arya_role
    WHERE role_code = 'ADMIN'
    LIMIT 1
);

INSERT INTO arya_role (
    role_id,
    role_code,
    role_name,
    description,
    active_flag
)
SELECT
    UUID(),
    'ADMIN',
    'Administrator',
    'Full system administration access',
    TRUE
WHERE @bootstrap_allowed = 1
  AND @admin_role_id IS NULL;

SET @admin_role_id = (
    SELECT role_id
    FROM arya_role
    WHERE role_code = 'ADMIN'
    LIMIT 1
);

INSERT INTO arya_user (
    user_id,
    full_name,
    email,
    password_hash,
    status
)
SELECT
    UUID(),
    @admin_full_name,
    @admin_email,
    @new_admin_password_hash,
    'ACTIVE'
WHERE @bootstrap_allowed = 1
  AND @admin_user_id IS NULL;

SET @admin_user_id = (
    SELECT user_id
    FROM arya_user
    WHERE email = @admin_email
    LIMIT 1
);

INSERT INTO arya_user_role (user_id, role_id)
SELECT @admin_user_id, @admin_role_id
WHERE @admin_user_id IS NOT NULL
  AND @admin_role_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM arya_user_role
      WHERE user_id = @admin_user_id
        AND role_id = @admin_role_id
  );

SELECT
    CASE
        WHEN @bootstrap_allowed = 0 THEN
            'BLOCKED: bootstrap admin does not exist. Set @new_admin_password_hash to a freshly generated bcrypt hash and execute again. No role/user changes were applied.'
        ELSE
            'SUCCESS: ADMIN role membership ensured. Existing admin credentials/status were not modified.'
    END AS result;

SELECT
    user_id,
    full_name,
    email,
    status
FROM arya_user
WHERE user_id = @admin_user_id;
