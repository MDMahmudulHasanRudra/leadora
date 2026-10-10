-- Agents see only their own and unassigned leads (product decision 2026-10-10). Seeing every lead now needs
-- lead.view_all, which the default roles other than AGENT get. Grant it to existing organizations' roles.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r."id", 'lead.view_all' FROM "roles" r
WHERE r."key" IN ('ADMIN', 'MANAGER', 'ANALYST', 'VIEWER')
ON CONFLICT DO NOTHING;
