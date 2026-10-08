-- Every organization gets an Email lead source (inbound email creates leads from it).
INSERT INTO "lead_sources" ("organization_id", "type", "name")
SELECT o."id", 'EMAIL', 'Email' FROM "organizations" o
ON CONFLICT ("organization_id", "name") DO NOTHING;
