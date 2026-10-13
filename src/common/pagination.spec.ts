import { isPaginated, pageAndLimit, toPaginated } from './pagination.js';

describe('paginación', () => {
  it('solo pagina si se pide page o limit', () => {
    expect(isPaginated({})).toBe(false);
    expect(isPaginated({ page: 1 })).toBe(true);
    expect(isPaginated({ limit: 10 })).toBe(true);
  });

  it('calcula el desplazamiento', () => {
    expect(pageAndLimit({})).toEqual({ page: 1, limit: 50, skip: 0 });
    expect(pageAndLimit({ page: 3, limit: 20 })).toEqual({
      page: 3,
      limit: 20,
      skip: 40,
    });
  });

  it('arma la respuesta con el total de páginas', () => {
    expect(toPaginated(['a', 'b'], 41, { page: 1, limit: 20 })).toEqual({
      data: ['a', 'b'],
      total: 41,
      page: 1,
      limit: 20,
      totalPages: 3,
    });

    expect(toPaginated([], 0, { page: 1 }).totalPages).toBe(0);
  });
});
