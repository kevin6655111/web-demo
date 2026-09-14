import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { EnvService } from '@/env/env.service';

const ISSUER = 'road-patrol-demo';
const AUDIENCE = 'road-patrol-demo-web';

/**
 * JWT 簽發與驗證：金鑰只在這裡讀，其他模組拿不到。
 *
 * 幾個刻意的設定：
 *   algorithms 白名單  —— 驗證時只接受 HS256，擋掉把 alg 改成 none 的老把戲
 *   issuer / audience —— 別的系統用同一把金鑰簽出來的 token 不能拿來用
 *   jti               —— 每張 token 有唯一識別，之後要做黑名單撤銷時有東西可以記
 */
@Injectable()
export class AuthTokenService {
  constructor(private readonly envService: EnvService) {}

  /** 簽發 Token */
  public jwtSign(payload: object): string {
    return jwt.sign({ ...payload, jti: randomUUID() }, this.envService.getJwtSecret(), {
      algorithm: 'HS256',
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: this.envService.getTokenExpirationSec()
    });
  }

  /** 驗證 Token；失敗一律丟例外，由 AuthGuard 轉成 401 */
  public jwtVerify<T>(token: string): Promise<T> {
    return new Promise((resolve, reject) => {
      jwt.verify(
        token,
        this.envService.getJwtSecret(),
        { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE },
        (err, decoded) => {
          if (err) return reject(err);
          resolve(decoded as T);
        }
      );
    });
  }
}
