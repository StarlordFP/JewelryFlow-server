import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponse<T> {
  success: true;
  data: T;
}

/**
 * TransformInterceptor
 *
 * Wraps every successful response in:
 * { success: true, data: <original payload> }
 *
 * Paginated services already return { data: [...], meta: {...} },
 * so the outer wrapper becomes: { success: true, data: { data: [...], meta: {...} } }
 * which keeps all layers explicit.
 */
@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    return next.handle().pipe(map((data) => ({ success: true, data })));
  }
}
