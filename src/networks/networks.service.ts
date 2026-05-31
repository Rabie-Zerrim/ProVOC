import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NetworksService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const networks = await this.prisma.network.findMany({
      where: { is_active: true },
      include: { preferences: true },
      orderBy: { name: 'asc' },
    });
    return networks.map((n) => ({
      network_id: n.network_id,
      name: n.name,
      slug: n.name.toLowerCase().replace(/\s+/g, ''),
      post_auth_type: n.preferences?.post_auth_type ?? null,
    }));
  }
}
