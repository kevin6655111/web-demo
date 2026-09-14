import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from './user.entity';

/**
 * 密碼歷史。
 *
 * 只為了一個規則存在：「不可與最近三次相同」。
 * 沒有這張表的話，使用者被要求改密碼時會改成舊的再改回來，
 * 政策等於沒有。只存雜湊，比對用 bcrypt.compare。
 */
@Entity({ name: 'password_histories' })
@Index('idx_password_history_user', ['user', 'createdAt'])
export class PasswordHistory {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'password_hash', type: 'varchar', length: 100 })
  passwordHash!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
