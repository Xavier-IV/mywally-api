import { Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async issueTokenForUserId(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User ${userId} not found`);
    const token = await this.jwt.signAsync({
      sub: user.id,
      role: user.role,
      phone: user.phone,
    });
    return { token, user };
  }

  async issueTokenForPhone(phone: string) {
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) throw new NotFoundException(`User with phone ${phone} not found`);
    return this.issueTokenForUserId(user.id);
  }
}
