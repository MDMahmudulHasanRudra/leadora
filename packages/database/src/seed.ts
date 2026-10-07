// The first organization and admin are created through the web setup page (/setup), which also
// seeds roles. Seeding an organization here would close first-run setup with no admin able to sign in.
// Demo CRM data (leads, pipeline) will be added here once those modules exist.
console.log(JSON.stringify({ level: 'info', service: 'seed', event: 'seed.skipped', message: 'Nothing to seed yet; use /setup' }));
