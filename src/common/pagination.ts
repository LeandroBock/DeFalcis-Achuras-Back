import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { FindManyOptions, ObjectLiteral, Repository } from 'typeorm';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number;
}

export type Paginated<T> = {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export function isPaginated(query: PaginationQueryDto) {
  return query.page !== undefined || query.limit !== undefined;
}

export function toPaginated<T>(
  data: T[],
  total: number,
  query: PaginationQueryDto,
): Paginated<T> {
  const { page, limit } = pageAndLimit(query);

  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export function pageAndLimit(query: PaginationQueryDto) {
  const page = query.page ?? 1;
  const limit = query.limit ?? DEFAULT_LIMIT;

  return { page, limit, skip: (page - 1) * limit };
}

// Paginación opcional: sin `page` ni `limit` devuelve la lista completa (como
// antes), así el frontend puede migrar de a una pantalla por vez.
export async function findMaybePaginated<T extends ObjectLiteral>(
  repository: Repository<T>,
  options: FindManyOptions<T>,
  query: PaginationQueryDto,
): Promise<T[] | Paginated<T>> {
  if (!isPaginated(query)) {
    return repository.find(options);
  }

  const { limit, skip } = pageAndLimit(query);

  const [data, total] = await repository.findAndCount({
    ...options,
    skip,
    take: limit,
  });

  return toPaginated(data, total, query);
}
