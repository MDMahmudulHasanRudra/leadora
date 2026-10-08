import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { loggerParams } from './common/logging';
import { HealthModule } from './health/health.module';
import { InfraModule } from './infra/infra.module';
import { QueuesModule } from './infra/queues.module';
import { CustomFieldsModule } from './custom-fields/custom-fields.module';
import { FollowupsModule } from './followups/followups.module';
import { TasksModule } from './tasks/tasks.module';
import { ContactsModule } from './contacts/contacts.module';
import { AssignmentModule } from './assignment/assignment.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { CommunicationModule } from './communication/communication.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RealtimeModule } from './realtime/realtime.module';
import { AiModule } from './ai/ai.module';
import { LeadsModule } from './leads/leads.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { TeamsModule } from './teams/teams.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    LoggerModule.forRoot(loggerParams(process.env.LOG_LEVEL ?? 'info')),
    InfraModule,
    QueuesModule,
    RealtimeModule,
    HealthModule,
    AuditModule,
    AuthModule,
    UsersModule,
    TeamsModule,
    OrganizationsModule,
    LeadsModule,
    CustomFieldsModule,
    FollowupsModule,
    TasksModule,
    ContactsModule,
    AssignmentModule,
    AnalyticsModule,
    CommunicationModule,
    NotificationsModule,
    AiModule,
  ],
})
export class AppModule {}
