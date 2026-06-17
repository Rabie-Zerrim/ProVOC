import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: {
    updateProfile: jest.Mock;
    getPreferences: jest.Mock;
    updatePreferences: jest.Mock;
  };

  beforeEach(async () => {
    usersService = {
      updateProfile: jest.fn(),
      getPreferences: jest.fn(),
      updatePreferences: jest.fn(),
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
});
