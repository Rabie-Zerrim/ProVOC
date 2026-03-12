import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Injectable()
export class AppService {
  constructor(private prisma: PrismaService) { }

  getHello(): string {
    return 'Hello World!';
  }

  async testDb() {
    try {
      const usersCount = await this.prisma.user.count();
      return { status: 'OK', message: 'Database connected!', usersCount };
    } catch (error) {
      return { status: 'ERROR', message: error.message };
    }
  }
}
