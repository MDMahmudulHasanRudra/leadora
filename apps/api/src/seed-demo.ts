// Demo data for local development and demos (spec §141 "Seed succeeds"): `pnpm db:seed`.
//
// Creates a separate "Demo Traders" organization with an admin and an agent, about forty leads across the
// pipeline, sources, owners and temperatures, and some follow-ups, then scores them. Credentials come from
// SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD and SEED_AGENT_EMAIL / SEED_AGENT_PASSWORD (DEV_* names also work).
// It never runs with NODE_ENV=production, and does nothing if the demo organization already exists.
//
// On a fresh install, run /setup for your real organization first: with ALLOW_SIGNUP=false, setup is only
// offered while no organization exists.
import 'reflect-metadata';
import { createDb, followups, leads, organizations, pipelineStages, userRoles, users } from '@leadora/database';
import { createLeadSchema, ingestLead, type IngestSourceType, rescoreOrganization } from '@leadora/domain';
import { and, eq } from 'drizzle-orm';
import { hashPassword } from './auth/password';
import { initializeOrganization } from './organizations/defaults';

const SLUG = 'demo-traders';
const env = process.env;

const FIRST = ['Rahim', 'Karim', 'Sadia', 'Nusrat', 'Tanvir', 'Farhana', 'Imran', 'Mitu', 'Arif', 'Shirin', 'Jamal', 'Rupa', 'Sohel', 'Tania', 'Habib', 'Lima'];
const LAST = ['Uddin', 'Ahmed', 'Islam', 'Hossain', 'Akter', 'Rahman', 'Chowdhury', 'Sarkar', 'Begum', 'Khan'];
const COMPANIES = ['Rupali Traders', 'Meghna Foods', 'Padma Textiles', 'Jamuna Electronics', 'Sonar Bangla Agro', 'Karnaphuli Logistics', 'Teesta Pharma', 'Dhaka Digital', 'Sylhet Tea House', 'Chattogram Steel'];
const INDUSTRIES = ['Retail', 'Food', 'Textiles', 'Electronics', 'Agriculture', 'Logistics', 'Pharma', 'Software'];
const SOURCES: IngestSourceType[] = ['MANUAL', 'WEBSITE', 'WHATSAPP', 'FACEBOOK', 'EMAIL', 'CSV'];
// Weighted toward the top of the funnel, like a real pipeline.
const STAGES = ['NEW', 'NEW', 'NEW', 'CONTACTED', 'CONTACTED', 'QUALIFIED', 'INTERESTED', 'NEGOTIATION', 'FOLLOW_UP', 'CONVERTED', 'LOST'];
const PRIORITIES = ['LOW', 'MEDIUM', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const TAGS = ['vip', 'wholesale', 'repeat', 'referral', 'eid-campaign'];

/** Deterministic, so every seeded database looks the same. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

async function main() {
  if (env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data with NODE_ENV=production');
  const adminEmail = env.SEED_ADMIN_EMAIL ?? env.DEV_ADMIN_EMAIL;
  const adminPassword = env.SEED_ADMIN_PASSWORD ?? env.DEV_ADMIN_PASSWORD;
  const agentEmail = env.SEED_AGENT_EMAIL ?? env.DEV_AGENT_EMAIL;
  const agentPassword = env.SEED_AGENT_PASSWORD ?? env.DEV_AGENT_PASSWORD;
  if (!env.DATABASE_URL || !adminEmail || !adminPassword) {
    throw new Error('DATABASE_URL, SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are required (SEED_AGENT_* optional)');
  }

  const { db, pool } = createDb(env.DATABASE_URL, { max: 2 });
  try {
    const [existing] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, SLUG));
    if (existing) {
      log('seed.skipped', 'Demo organization already exists');
      return;
    }

    const random = rng(20261010);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(random() * xs.length)]!;
    const now = Date.now();
    const DAY = 86_400_000;

    const result = await db.transaction(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({ name: 'Demo Traders', slug: SLUG, timezone: 'Asia/Dhaka', defaultCurrency: 'BDT', defaultCountry: 'BD' })
        .returning();
      const { roleIds } = await initializeOrganization(tx, org!.id);

      const addUser = async (email: string, password: string, fullName: string, role: keyof typeof roleIds) => {
        const [u] = await tx
          .insert(users)
          .values({ organizationId: org!.id, email, fullName, status: 'ACTIVE', passwordHash: await hashPassword(password) })
          .returning({ id: users.id });
        await tx.insert(userRoles).values({ userId: u!.id, roleId: roleIds[role] });
        return u!.id;
      };
      const adminId = await addUser(adminEmail, adminPassword, 'Demo Admin', 'ADMIN');
      const agentId = agentEmail && agentPassword ? await addUser(agentEmail, agentPassword, 'Demo Agent', 'AGENT') : null;

      const stages = await tx.select().from(pipelineStages).where(eq(pipelineStages.organizationId, org!.id));
      const stageByKey = new Map(stages.map((s) => [s.key, s]));

      let created = 0;
      for (let i = 0; i < 40; i++) {
        const first = pick(FIRST);
        const last = pick(LAST);
        const stage = stageByKey.get(pick(STAGES))!;
        const owner = random() < 0.2 ? null : agentId && random() < 0.5 ? agentId : adminId;
        const res = await ingestLead(
          tx,
          { organizationId: org!.id, actorUserId: adminId, sourceType: pick(SOURCES) },
          createLeadSchema.parse({
            fullName: `${first} ${last}`,
            email: `${first}.${last}.${i}@example.com`.toLowerCase(),
            phone: `017${String(10_000_000 + Math.floor(random() * 89_999_999)).slice(0, 8)}`,
            companyName: pick(COMPANIES),
            industry: pick(INDUSTRIES),
            budget: Math.round(20 + random() * 980) * 1000,
            currency: 'BDT',
            priority: pick(PRIORITIES),
            stageId: stage.id,
            ownerUserId: owner,
            tags: random() < 0.4 ? [pick(TAGS)] : [],
            notes: random() < 0.3 ? 'Asked for a price list on WhatsApp.' : undefined,
          }),
        );
        if (res.status !== 'CREATED') continue;
        created++;

        // Spread creation over the last 60 days so analytics have a history.
        const createdAt = new Date(now - Math.floor(random() * 60) * DAY - Math.floor(random() * DAY));
        const contacted = stage.key !== 'NEW';
        await tx
          .update(leads)
          .set({
            createdAt,
            lastContactedAt: contacted ? new Date(createdAt.getTime() + Math.floor(random() * 3 * DAY)) : null,
            convertedAt: stage.outcome === 'WON' ? new Date(Math.min(now, createdAt.getTime() + (5 + Math.floor(random() * 20)) * DAY)) : null,
            lostAt: stage.outcome === 'LOST' ? new Date(Math.min(now, createdAt.getTime() + (3 + Math.floor(random() * 15)) * DAY)) : null,
          })
          .where(and(eq(leads.id, res.leadId), eq(leads.organizationId, org!.id)));

        if (stage.outcome === 'OPEN' && random() < 0.45) {
          // Some overdue, some upcoming.
          const scheduledAt = new Date(now + (random() < 0.4 ? -1 : 1) * Math.floor(1 + random() * 72) * 3_600_000);
          await tx.insert(followups).values({
            organizationId: org!.id,
            leadId: res.leadId,
            assignedUserId: owner ?? adminId,
            createdByUserId: adminId,
            type: pick(['CALL', 'MESSAGE', 'MEETING'] as const),
            scheduledAt,
            priority: pick(PRIORITIES),
          });
          await tx.update(leads).set({ nextFollowupAt: scheduledAt }).where(eq(leads.id, res.leadId));
        }
      }
      return { organizationId: org!.id, created };
    });

    // Leads are scored as they are created; rescoring once more picks up the back-dated contact times.
    await rescoreOrganization(db, result.organizationId);
    log('seed.completed', `Demo Traders: ${result.created} leads. Sign in as ${adminEmail}.`);
  } finally {
    await pool.end();
  }
}

function log(event: string, message: string) {
  console.log(JSON.stringify({ level: 'info', service: 'seed', event, message }));
}

main().catch((err: Error) => {
  console.error(JSON.stringify({ level: 'error', service: 'seed', event: 'seed.failed', message: err.message }));
  process.exitCode = 1;
});
