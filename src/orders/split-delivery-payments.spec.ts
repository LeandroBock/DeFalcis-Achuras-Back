import { PaymentMethod } from '../payments/entities/payments.entity.js';
import { splitDeliveryPayments } from './orders.service.js';

const cash = (amount: number) => ({ amount, method: PaymentMethod.CASH });
const transfer = (amount: number) => ({
  amount,
  method: PaymentMethod.TRANSFER,
});

describe('reparto de lo cobrado en la entrega', () => {
  it('si no supera el total, todo paga la nota', () => {
    expect(splitDeliveryPayments([cash(300), transfer(200)], 1000)).toEqual({
      forOrder: [cash(300), transfer(200)],
      forDebt: [],
    });
  });

  it('lo que sobra va a la deuda anterior, partiendo el cobro si hace falta', () => {
    expect(splitDeliveryPayments([cash(800), transfer(700)], 1000)).toEqual({
      forOrder: [cash(800), transfer(200)],
      forDebt: [transfer(500)],
    });
  });

  it('no pierde centavos', () => {
    const { forOrder, forDebt } = splitDeliveryPayments(
      [cash(0.1), cash(0.2), cash(1000.05)],
      1000.3,
    );
    expect(forOrder.map((p) => p.amount)).toEqual([0.1, 0.2, 1000]);
    expect(forDebt.map((p) => p.amount)).toEqual([0.05]);
  });
});
