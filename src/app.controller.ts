import { Controller, Get, NotFoundException } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) { }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Get('test-db')
  testDb() {
    if (process.env.NODE_ENV === 'production') {
      throw new NotFoundException();
    }
    return this.appService.testDb();
  }
}
