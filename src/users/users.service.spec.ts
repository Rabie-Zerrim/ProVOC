import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

const USER_ID = 'uuid-user-1';
const OTHER_USER_ID = 'uuid-user-2';

const mockCredential = {
  credential_id: 'uuid-cred-1',
  user_id: USER_ID,
  email: 'jane@example.com',
  user: { user_id: USER_ID, display_name: 'Jane Doe' },
};

const mockPreference = {
  pref_id: 'uuid-pref-1',
  user_id: USER_ID,
  default_tone: 'neutral',
  preferred_networks: [],
  review_reminder_delay: null,
  location_tracking: true,
};

describe('UsersService', () => {
  let service: UsersService;
  let prisma: {
    user: { update: jest.Mock };
    userCredential: { findUnique: jest.Mock; update: jest.Mock };
    userPreference: { upsert: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      user: { update: jest.fn() },
      userCredential: { findUnique: jest.fn(), update: jest.fn() },
      userPreference: { upsert: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  // ── updateProfile ────────────────────────────────────────────────────────────

  describe('updateProfile', () => {
    it('updates display_name only and returns the merged profile', async () => {
      prisma.user.update.mockResolvedValue({});
      prisma.userCredential.findUnique.mockResolvedValue({
        ...mockCredential,
        user: { ...mockCredential.user, display_name: 'New Name' },
      });

      const result = await service.updateProfile(USER_ID, { display_name: 'New Name' });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { user_id: USER_ID },
        data: { display_name: 'New Name' },
      });
      expect(prisma.userCredential.update).not.toHaveBeenCalled();
      expect(result).toEqual({
        user_id: USER_ID,
        email: 'jane@example.com',
        display_name: 'New Name',
      });
    });

    it('updates email when it is not used by another user', async () => {
      prisma.userCredential.findUnique
        .mockResolvedValueOnce(null) // uniqueness check
        .mockResolvedValueOnce({ ...mockCredential, email: 'new@example.com' }); // final re-fetch
      prisma.userCredential.update.mockResolvedValue({});

      const result = await service.updateProfile(USER_ID, { email: 'new@example.com' });

      expect(prisma.userCredential.findUnique).toHaveBeenNthCalledWith(1, {
        where: { email: 'new@example.com' },
      });
      expect(prisma.userCredential.update).toHaveBeenCalledWith({
        where: { user_id: USER_ID },
        data: { email: 'new@example.com' },
      });
      expect(result.email).toBe('new@example.com');
    });

    it('allows setting email to the value already owned by the same user', async () => {
      prisma.userCredential.findUnique
        .mockResolvedValueOnce({ ...mockCredential, user_id: USER_ID })
        .mockResolvedValueOnce(mockCredential);
      prisma.userCredential.update.mockResolvedValue({});

      await expect(
        service.updateProfile(USER_ID, { email: 'jane@example.com' }),
      ).resolves.toBeDefined();
      expect(prisma.userCredential.update).toHaveBeenCalled();
    });

    it('throws ConflictException (409) when email belongs to another user', async () => {
      prisma.userCredential.findUnique.mockResolvedValue({
        ...mockCredential,
        user_id: OTHER_USER_ID,
      });

      await expect(
        service.updateProfile(USER_ID, { email: 'taken@example.com' }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.userCredential.update).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when neither display_name nor email is provided', async () => {
      await expect(service.updateProfile(USER_ID, {})).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.userCredential.update).not.toHaveBeenCalled();
    });
  });

  // ── getPreferences ───────────────────────────────────────────────────────────

  describe('getPreferences', () => {
    it('upserts with default values and returns the preference row', async () => {
      prisma.userPreference.upsert.mockResolvedValue(mockPreference);

      const result = await service.getPreferences(USER_ID);

      expect(prisma.userPreference.upsert).toHaveBeenCalledWith({
        where: { user_id: USER_ID },
        update: {},
        create: {
          user_id: USER_ID,
          default_tone: 'neutral',
          preferred_networks: [],
          review_reminder_delay: null,
          location_tracking: true,
        },
      });
      expect(result).toEqual(mockPreference);
    });
  });

  // ── updatePreferences ────────────────────────────────────────────────────────

  describe('updatePreferences', () => {
    it('upserts preferred_networks on an existing row', async () => {
      prisma.userPreference.upsert.mockResolvedValue({
        ...mockPreference,
        preferred_networks: ['yelp'],
      });

      const result = await service.updatePreferences(USER_ID, { preferred_networks: ['yelp'] });

      expect(prisma.userPreference.upsert).toHaveBeenCalledWith({
        where: { user_id: USER_ID },
        update: { preferred_networks: ['yelp'] },
        create: expect.objectContaining({
          user_id: USER_ID,
          preferred_networks: ['yelp'],
        }),
      });
      expect(result.preferred_networks).toEqual(['yelp']);
    });

    it('creates a row with defaults plus preferred_networks when none exists yet', async () => {
      prisma.userPreference.upsert.mockResolvedValue({
        ...mockPreference,
        preferred_networks: ['tripadvisor'],
      });

      await service.updatePreferences(USER_ID, { preferred_networks: ['tripadvisor'] });

      expect(prisma.userPreference.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: {
            user_id: USER_ID,
            default_tone: 'neutral',
            preferred_networks: ['tripadvisor'],
            review_reminder_delay: null,
            location_tracking: true,
          },
        }),
      );
    });

    it('leaves preferred_networks untouched in update when not provided', async () => {
      prisma.userPreference.upsert.mockResolvedValue(mockPreference);

      await service.updatePreferences(USER_ID, {});

      expect(prisma.userPreference.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: {} }),
      );
    });
  });

  // ── updateAvatar ─────────────────────────────────────────────────────────────

  describe('updateAvatar', () => {
    it('saves a small avatar payload and returns it', async () => {
      const avatarData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
      prisma.user.update.mockResolvedValue({});

      const result = await service.updateAvatar(USER_ID, { avatar_data: avatarData });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { user_id: USER_ID },
        data: { avatar_data: avatarData },
      });
      expect(result).toEqual({ avatar_data: avatarData });
    });

    it('saves a raw base64 string (no data URI prefix) just as well', async () => {
      const avatarData = 'iVBORw0KGgoAAAANSUhEUg==';
      prisma.user.update.mockResolvedValue({});

      const result = await service.updateAvatar(USER_ID, { avatar_data: avatarData });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { user_id: USER_ID },
        data: { avatar_data: avatarData },
      });
      expect(result).toEqual({ avatar_data: avatarData });
    });

    it('throws BadRequestException when the decoded payload exceeds 2MB and does not write to the DB', async () => {
      // 2,800,000 base64 chars -> 2,100,000 decoded bytes, just over the 2MB (2,097,152 byte) limit
      const oversizedPayload = 'A'.repeat(2_800_000);
      const avatarData = `data:image/jpeg;base64,${oversizedPayload}`;

      await expect(
        service.updateAvatar(USER_ID, { avatar_data: avatarData }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
