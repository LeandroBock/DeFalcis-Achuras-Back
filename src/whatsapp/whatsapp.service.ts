import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product, ProductUnit } from '../products/entities/product.entity.js';
import { Customer } from '../customers/entities/customer.entity.js';
import { OrdersService } from '../orders/orders.service.js';
import {
  WhatsAppMessage,
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
  WhatsAppMessageType,
} from './entities/whatsapp-message.entity.js';
import { Order } from '../orders/entities/order.entity.js';
import {
  WhatsAppOrder,
  WhatsAppOrderStatus,
} from './entities/whatsapp-order.entity.js';
import { PaymentsService } from '../payments/payments.service.js';

@Injectable()
export class WhatsAppService {
  constructor(
    @InjectRepository(WhatsAppMessage)
    private readonly messagesRepository: Repository<WhatsAppMessage>,

    @InjectRepository(Customer)
    private readonly customersRepository: Repository<Customer>,

    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,

    @InjectRepository(WhatsAppOrder)
    private readonly whatsappOrdersRepository: Repository<WhatsAppOrder>,

    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
    private readonly ordersService: OrdersService,
    private readonly paymentsService: PaymentsService,
  ) {}

  async createIncomingMessage(data: {
    phone: string;
    message: string;
    customerId?: string;
    externalMessageId?: string;
  }) {
    let customerId = data.customerId;

    // Si no recibimos customerId, buscamos al cliente por teléfono
    if (!customerId) {
      const customer = await this.customersRepository.findOne({
        where: {
          phone: data.phone,
        },
      });

      if (customer) {
        customerId = customer.id;
      }
    }

    const whatsappMessage = this.messagesRepository.create({
      phone: data.phone,
      message: data.message,
      customerId,
      externalMessageId: data.externalMessageId,
      direction: WhatsAppMessageDirection.INCOMING,
      type: WhatsAppMessageType.TEXT,
      status: WhatsAppMessageStatus.RECEIVED,
    });

    return this.messagesRepository.save(whatsappMessage);
  }

  async createOutgoingMessage(data: {
    phone: string;
    message: string;
    customerId?: string;
    externalMessageId?: string;
  }) {
    let customerId = data.customerId;

    // Si no recibimos customerId, buscamos al cliente por teléfono
    if (!customerId) {
      const customer = await this.customersRepository.findOne({
        where: {
          phone: data.phone,
        },
      });

      if (customer) {
        customerId = customer.id;
      }
    }

    const whatsappMessage = this.messagesRepository.create({
      phone: data.phone,
      message: data.message,
      customerId,
      externalMessageId: data.externalMessageId,
      direction: WhatsAppMessageDirection.OUTGOING,
      type: WhatsAppMessageType.TEXT,
      status: WhatsAppMessageStatus.SENT,
    });

    return this.messagesRepository.save(whatsappMessage);
  }

  async analyzeOrder(message: string) {
    const normalizedMessage = message
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const products = await this.productsRepository.find({
      where: {
        isActive: true,
      },
    });

    const product = products.find((item) => {
      const normalizedProductName = item.name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

      return normalizedMessage.includes(normalizedProductName);
    });

    if (!product) {
      return {
        found: false,
        message: 'No pude identificar el producto.',
      };
    }

    const quantityMatch = normalizedMessage.match(
      /(\d+(?:[.,]\d+)?)\s*(kg|kilos?|unidades?|unidad)?/,
    );

    if (!quantityMatch) {
      return {
        found: true,
        productId: product.id,
        productName: product.name,
        message: 'Encontré el producto, pero no la cantidad.',
      };
    }

    const quantity = Number(quantityMatch[1].replace(',', '.'));

    let unit = product.unit;

    if (quantityMatch[2] === 'unidad' || quantityMatch[2] === 'unidades') {
      unit = ProductUnit.UNIT;
    }

    if (
      quantityMatch[2] === 'kg' ||
      quantityMatch[2] === 'kilo' ||
      quantityMatch[2] === 'kilos'
    ) {
      unit = ProductUnit.KG;
    }

    const stock = Number(product.stock);
    const salePrice = Number(product.salePrice);
    const subtotal = quantity * salePrice;

    const available = stock >= quantity;

    return {
      found: true,
      productId: product.id,
      productName: product.name,
      quantity,
      unit,
      salePrice,
      stock,
      subtotal,
      available,
      message: available
        ? 'Producto y stock disponibles.'
        : 'No hay stock suficiente.',
    };
  }

  async prepareOrder(data: { phone: string; message: string }) {
    const analysis = await this.analyzeOrder(data.message);

    if (!analysis.found) {
      return analysis;
    }

    if (!analysis.quantity) {
      return analysis;
    }

    if (!analysis.available) {
      return analysis;
    }

    const customer = await this.customersRepository.findOne({
      where: {
        phone: data.phone,
      },
    });

    const whatsappOrder = this.whatsappOrdersRepository.create({
      phone: data.phone,
      customerId: customer?.id,
      productId: analysis.productId,
      quantity: analysis.quantity,
      unit: analysis.unit,
      unitPrice: analysis.salePrice,
      subtotal: analysis.subtotal,
      status: WhatsAppOrderStatus.PENDING,
    });

    const savedOrder = await this.whatsappOrdersRepository.save(whatsappOrder);

    return {
      message: 'Pedido preparado. Esperando confirmación del cliente.',
      order: savedOrder,
      confirmationMessage:
        `Encontré ${analysis.quantity} ${analysis.unit} de ` +
        `${analysis.productName}. ` +
        `El total es $${analysis.subtotal}. ` +
        `¿Confirmás el pedido?`,
    };
  }

  async confirmOrder(id: string) {
    const whatsappOrder = await this.whatsappOrdersRepository.findOne({
      where: {
        id,
      },
    });

    if (!whatsappOrder) {
      throw new NotFoundException('Pedido de WhatsApp no encontrado');
    }

    if (whatsappOrder.status !== WhatsAppOrderStatus.PENDING) {
      throw new BadRequestException('El pedido de WhatsApp ya fue procesado');
    }

    if (!whatsappOrder.customerId) {
      throw new BadRequestException('No se pudo identificar al cliente');
    }

    const result = await this.ordersService.create({
      customerId: whatsappOrder.customerId,
      items: [
        {
          productId: whatsappOrder.productId,
          quantity: Number(whatsappOrder.quantity),
        },
      ],
    });

    whatsappOrder.status = WhatsAppOrderStatus.CONFIRMED;
    whatsappOrder.orderId = result.order.id;

    await this.whatsappOrdersRepository.save(whatsappOrder);
    return {
      message: 'Pedido confirmado correctamente.',
      whatsappOrder,
      order: result.order,
      items: result.items,
    };
  }

  async findAll() {
    return this.messagesRepository.find({
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async findByPhone(phone: string) {
    return this.messagesRepository.find({
      where: {
        phone,
      },
      order: {
        createdAt: 'ASC',
      },
    });
  }

  async processIncomingMessage(data: { phone: string; message: string }) {
    // 1. Guardar mensaje recibido
    const incomingMessage = await this.createIncomingMessage({
      phone: data.phone,
      message: data.message,
    });

    const normalizedMessage = data.message.toLowerCase().trim();

    // 2. Buscar pedido pendiente del cliente
    const pendingOrder = await this.whatsappOrdersRepository.findOne({
      where: {
        phone: data.phone,
        status: WhatsAppOrderStatus.PENDING,
      },
      order: {
        createdAt: 'DESC',
      },
    });

    // 3. Si hay pedido pendiente y el cliente confirma
    if (
      pendingOrder &&
      ['si', 'sí', 'confirmo', 'confirmar', 'ok'].includes(normalizedMessage)
    ) {
      const result = await this.confirmOrder(pendingOrder.id);

      const outgoingMessage = await this.createOutgoingMessage({
        phone: data.phone,
        customerId: pendingOrder.customerId,
        message:
          `✅ Pedido confirmado correctamente. ` +
          `Total: $${result.order.total}.`,
      });

      return {
        incomingMessage,
        outgoingMessage,
        order: result.order,
        whatsappOrder: result.whatsappOrder,
      };
    }

    // 4. Si hay pedido pendiente pero no confirma
    if (pendingOrder) {
      const outgoingMessage = await this.createOutgoingMessage({
        phone: data.phone,
        customerId: pendingOrder.customerId,
        message:
          'Tengo un pedido pendiente de confirmación. ' +
          'Respondé "sí" para confirmarlo.',
      });

      return {
        incomingMessage,
        outgoingMessage,
        whatsappOrder: pendingOrder,
      };
    }

    // 5. Analizar nuevo pedido
    const analysis = await this.analyzeOrder(data.message);

    if (!analysis.found) {
      const outgoingMessage = await this.createOutgoingMessage({
        phone: data.phone,
        message:
          'No pude identificar el producto de tu pedido. ' +
          'Por favor indicame el producto y la cantidad.',
      });

      return {
        incomingMessage,
        outgoingMessage,
        analysis,
      };
    }

    if (!analysis.quantity) {
      const outgoingMessage = await this.createOutgoingMessage({
        phone: data.phone,
        message:
          `Encontré ${analysis.productName}, ` +
          'pero necesito saber qué cantidad querés.',
      });

      return {
        incomingMessage,
        outgoingMessage,
        analysis,
      };
    }

    if (!analysis.available) {
      const outgoingMessage = await this.createOutgoingMessage({
        phone: data.phone,
        message:
          `No tenemos suficiente stock de ` +
          `${analysis.productName}. ` +
          `Stock disponible: ${analysis.stock} ${analysis.unit}.`,
      });

      return {
        incomingMessage,
        outgoingMessage,
        analysis,
      };
    }

    // 6. Preparar pedido
    // 6. Preparar pedido
    const preparedOrder = await this.prepareOrder({
      phone: data.phone,
      message: data.message,
    });

    // Verificamos que el pedido realmente haya sido preparado
    if (
      !('confirmationMessage' in preparedOrder) ||
      !('order' in preparedOrder)
    ) {
      return {
        incomingMessage,
        result: preparedOrder,
      };
    }

    const outgoingMessage = await this.createOutgoingMessage({
      phone: data.phone,
      customerId: preparedOrder.order.customerId,
      message: preparedOrder.confirmationMessage,
    });

    return {
      incomingMessage,
      outgoingMessage,
      whatsappOrder: preparedOrder.order,
    };
  }

  async getConversation(phone: string) {
    const [messages, whatsappOrders] = await Promise.all([
      this.messagesRepository.find({
        where: { phone },
        order: { createdAt: 'ASC' },
      }),

      this.whatsappOrdersRepository.find({
        where: { phone },
        order: { createdAt: 'ASC' },
      }),
    ]);

    const orders = await Promise.all(
      whatsappOrders.map(async (whatsappOrder) => {
        let realOrder = null;
        let paymentSummary = null;

        if (whatsappOrder.orderId) {
          realOrder = await this.ordersRepository.findOne({
            where: {
              id: whatsappOrder.orderId,
            },
          });

          if (realOrder) {
            paymentSummary = await this.paymentsService.findByOrder(
              realOrder.id,
            );
          }
        }

        const total =
          realOrder?.total != null
            ? Number(realOrder.total)
            : Number(whatsappOrder.subtotal);

        return {
          id: whatsappOrder.id,

          orderId: whatsappOrder.orderId ?? null,

          status: realOrder?.status ?? whatsappOrder.status,

          paymentStatus:
            paymentSummary?.paymentStatus ?? realOrder?.paymentStatus ?? null,

          total,

          paidAmount: paymentSummary?.paidAmount ?? 0,

          pendingAmount: paymentSummary?.pendingAmount ?? total,

          createdAt: realOrder?.createdAt ?? whatsappOrder.createdAt,

          productId: whatsappOrder.productId,

          quantity: Number(whatsappOrder.quantity),

          unit: whatsappOrder.unit,

          unitPrice: Number(whatsappOrder.unitPrice),

          subtotal: Number(whatsappOrder.subtotal),
        };
      }),
    );

    return {
      phone,
      messages,
      orders,
    };
  }
  async getConversations() {
    const messages = await this.messagesRepository.find({
      order: {
        createdAt: 'DESC',
      },
    });

    const uniquePhones = [...new Set(messages.map((message) => message.phone))];

    const conversations = await Promise.all(
      uniquePhones.map(async (phone) => {
        const customer = await this.customersRepository.findOne({
          where: {
            phone,
          },
        });

        const lastMessage = messages.find((message) => message.phone === phone);

        return {
          phone,
          customerId: customer?.id ?? null,
          customerName: customer?.name ?? 'Cliente desconocido',
          lastMessage: lastMessage?.message ?? '',
          lastMessageDate: lastMessage?.createdAt ?? null,
        };
      }),
    );

    return conversations;
  }
}
