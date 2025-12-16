import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  controllers: [AppController],
  providers: [AppService],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // so you don’t import it everywhere
      envFilePath: ['.env'] // you can add '.env.local' later if you want
    })
  ]
})
export class AppModule {}
