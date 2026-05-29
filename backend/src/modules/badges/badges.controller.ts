import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { BadgesService } from './badges.service';

@ApiTags('badges')
@ApiBearerAuth()
@Controller('badges')
export class BadgesController {
  constructor(private readonly badges: BadgesService) {}

  @Get()
  @ApiOperation({ summary: 'F5 — contadores de novidade pros badges do menu' })
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.badges.getBadges(user);
  }
}
