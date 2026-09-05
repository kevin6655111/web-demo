import { Column, Entity, OneToMany, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { User } from './user.entity';

/** 角色：actions 直接存字串陣列，登入時整包放進 JWT，之後不必再查 DB */
@Entity({ name: 'roles' })
@Unique('uq_role_key', ['key'])
export class Role {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'key', type: 'varchar', length: 20 })
  key!: string;

  @Column({ name: 'name', type: 'varchar', length: 50 })
  name!: string;

  @Column({ name: 'actions', type: 'text', array: true, default: () => "'{}'" })
  actions!: string[];

  @OneToMany(() => User, (u) => u.role)
  users!: User[];
}
