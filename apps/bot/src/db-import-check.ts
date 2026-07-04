import { PaymentStatus, prisma, UserStatus } from '@tg-bot/db';

const _userStatus: UserStatus = UserStatus.NEW;
const _paymentStatus: PaymentStatus = PaymentStatus.PENDING;

void prisma;
void _userStatus;
void _paymentStatus;
