# Glossary

Canonical domain language for Leadora AI. Use these words in code, UI, tests and conversation. Implementation details belong in [docs/](docs/), not here.

## Workspace

**Organization**
A company using Leadora. Every user, lead, conversation and setting belongs to exactly one organization. Data never crosses organizations. Also called a tenant; prefer "organization".

**User**
A person who signs in to an organization. A user belongs to one organization and is identified by an email address that is unique across all of Leadora. A user is *active*, *invited* or *disabled*. A disabled user cannot sign in and loses access immediately.

**Admin**
A user with the Admin role. The person who sets up an organization becomes its first admin.

**Role**
A named bundle of permissions given to a user: Admin, Manager, Agent, Analyst or Viewer. A user can only grant roles that carry no more access than their own.

**Permission**
A single allowed action, such as "assign leads" or "view the audit log". Permissions are granted through roles, never to users directly.

**Team**
A named group of users inside an organization, such as "Dhaka Inbound". Teams are used to assign leads and to report on performance. A user may belong to several teams.

**Session**
A signed-in browser. Signing out ends that session. Disabling a user ends all of their sessions.

**Audit log**
The permanent record of who did what and when: sign-ins and administrative changes. Entries are never edited or removed.

**First-run setup**
Creating the very first organization and its admin on a new installation. After that, new people join only when an admin adds them, unless open signup is turned on.

## Sales (planned, Phase 1 continued)

**Lead**
A potential customer who has not converted yet. A lead comes from a *source*, moves through *pipeline stages*, and has an *owner*.

**Contact**
A person known to the organization, usually created when a lead converts. Converting never deletes the original lead.

**Company**
An organization that contacts work for. Do not confuse with **Organization**, which is the Leadora customer itself.

**Owner** vs **Assignee**
The owner is the user responsible for a lead. "Assigning" a lead means changing its owner.
