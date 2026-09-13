import { Module } from '@nestjs/common';
import { GoogleCalendarService } from './google-calendar.service';
import { GoogleDriveService } from './google-drive.service';
import { GoogleOAuthController } from './google-oauth.controller';
import { GoogleOAuthService } from './google-oauth.service';

@Module({
  controllers: [GoogleOAuthController],
  providers: [GoogleOAuthService, GoogleCalendarService, GoogleDriveService],
  exports: [GoogleOAuthService, GoogleCalendarService, GoogleDriveService],
})
export class GoogleModule {}
