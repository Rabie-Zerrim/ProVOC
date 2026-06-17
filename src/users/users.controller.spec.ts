import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import * as request from 'supertest';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: {
    updateProfile: jest.Mock;
    getPreferences: jest.Mock;
    updatePreferences: jest.Mock;
    updateAvatar: jest.Mock;
    changePassword: jest.Mock;
  };

  beforeEach(async () => {
    usersService = {
      updateProfile: jest.fn(),
      getPreferences: jest.fn(),
      updatePreferences: jest.fn(),
      updateAvatar: jest.fn(),
      changePassword: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('updateProfile delegates to UsersService with the requesting user_id', async () => {
    const dto = { display_name: 'New Name' };
    usersService.updateProfile.mockResolvedValue({ user_id: 'user-1', email: 'a@b.com', display_name: 'New Name' });

    const result = await controller.updateProfile({ user: { user_id: 'user-1' } }, dto);

    expect(usersService.updateProfile).toHaveBeenCalledWith('user-1', dto);
    expect(result).toEqual({ user_id: 'user-1', email: 'a@b.com', display_name: 'New Name' });
  });

  it('getPreferences delegates to UsersService with the requesting user_id', async () => {
    usersService.getPreferences.mockResolvedValue({ preferred_networks: [] });

    const result = await controller.getPreferences({ user: { user_id: 'user-1' } });

    expect(usersService.getPreferences).toHaveBeenCalledWith('user-1');
    expect(result).toEqual({ preferred_networks: [] });
  });

  it('updatePreferences delegates to UsersService with the requesting user_id', async () => {
    const dto = { preferred_networks: ['yelp'] };
    usersService.updatePreferences.mockResolvedValue({ preferred_networks: ['yelp'] });

    const result = await controller.updatePreferences({ user: { user_id: 'user-1' } }, dto);

    expect(usersService.updatePreferences).toHaveBeenCalledWith('user-1', dto);
    expect(result).toEqual({ preferred_networks: ['yelp'] });
  });

  it('updateAvatar delegates to UsersService with the requesting user_id', async () => {
    const dto = { avatar_data: 'data:image/png;base64,abc' };
    usersService.updateAvatar.mockResolvedValue({ avatar_data: 'data:image/png;base64,abc' });

    const result = await controller.updateAvatar({ user: { user_id: 'user-1' } }, dto);

    expect(usersService.updateAvatar).toHaveBeenCalledWith('user-1', dto);
    expect(result).toEqual({ avatar_data: 'data:image/png;base64,abc' });
  });

  it('changePassword delegates to UsersService with the requesting user_id', async () => {
    const dto = { current_password: 'old-pass', new_password: 'new-password-123' };
    usersService.changePassword.mockResolvedValue({ success: true });

    const result = await controller.changePassword({ user: { user_id: 'user-1' } }, dto);

    expect(usersService.changePassword).toHaveBeenCalledWith('user-1', dto);
    expect(result).toEqual({ success: true });
  });
});

describe('UsersController (HTTP guard)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: { updateAvatar: jest.fn() } },
        JwtStrategy,
        { provide: ConfigService, useValue: { get: () => 'test-secret' } },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 from PATCH /users/me/avatar when no Authorization header is sent', () => {
    return request(app.getHttpServer())
      .patch('/users/me/avatar')
      .send({ avatar_data: 'data:image/jpeg;base64,abc' })
      .expect(401);
  });
});
