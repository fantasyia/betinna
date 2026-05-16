import { Module } from '@nestjs/common';
import { GoogleCalendarService } from './google-calendar.service';
import { GoogleOAuthController } from './google-oauth.controller';
import { GoogleOAuthService } from './google-oauth.service';

@Module({
  controllers: [GoogleOAuthController],
  providers: [GoogleOAuthService, GoogleCalendarService],
  exports: [GoogleOAuthService, GoogleCalendarService],
})
export class GoogleModule {}
