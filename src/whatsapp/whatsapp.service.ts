import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Product, ProductUnit } from '../products/entities/product.entity.js';
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
import {
  PaginationQueryDto,
  findMaybePaginated,
  isPaginated,
  pageAndLimit,
  toPaginated,
} from '../common/pagination.js';
import { WhatsAppInboxService } from './whatsapp-inbox.service.js';

@Injectable()
export class WhatsAppService {
  constructor(
    @InjectRepository(WhatsAppMessage)
    private readonly messagesRepository: Repository<WhatsAppMessage>,

    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,

    @InjectRepository(WhatsAppOrder)
    private readonly whatsappOrdersRepository: Repository<WhatsAppOrder>,

    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
    private readonly ordersService: OrdersService,
    private readonly paymentsService: PaymentsService,
    private readonly dataSource: DataSource,
    private readonly inbox: WhatsAppInboxService,
  ) {}

  async createIncomingMessage(data: {
    phone: string;
    message: string;
    customerId?: string;
    externalMessageId?: string;
  }) {
    // Si no recibimos customerId, buscamos al cliente por teléfono
    const customerId =
      data.customerId ?? (await this.inbox.findCustomerByPhone(data.phone))?.id;

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
    // Si no recibimos customerId, buscamos al cliente por teléfono
    const customerId =
      data.customerId ?? (await this.inbox.findCustomerByPhone(data.phone))?.id;

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

    // Informativo: las achuras pierden peso (agua), así que el stock
    // registrado puede no coincidir con el real. Nunca se rechaza un pedido
    // por falta de stock.
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
        : 'El stock registrado no alcanza; el pedido se toma igual.',
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

    const customer = await this.inbox.findCustomerByPhone(data.phone);

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
    return this.dataSource.transaction(async (manager) => {
      const whatsappOrderRepository = manager.getRepository(WhatsAppOrder);

      // Bloquea el pedido de WhatsApp: si se confirma dos veces a la vez, la
      // segunda espera y ve el estado CONFIRMED, en lugar de crear otro pedido.
      const whatsappOrder = await whatsappOrderRepository.findOne({
        where: {
          id,
        },
        lock: { mode: 'pessimistic_write' },
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

      const result = await this.ordersService.create(
        {
          customerId: whatsappOrder.customerId,
          items: [
            {
              productId: whatsappOrder.productId,
              quantity: Number(whatsappOrder.quantity),
            },
          ],
        },
        manager,
      );

      whatsappOrder.status = WhatsAppOrderStatus.CONFIRMED;
      whatsappOrder.orderId = result.order.id;

      await whatsappOrderRepository.save(whatsappOrder);

      return {
        message: 'Pedido confirmado correctamente.',
        whatsappOrder,
        order: result.order,
        items: result.items,
      };
    });
  }

  async findAll(query: PaginationQueryDto) {
    return findMaybePaginated(
      this.messagesRepository,
      { order: { createdAt: 'DESC', id: 'DESC' } },
      query,
    );
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
  // Último mensaje de cada teléfono, del más reciente al más antiguo, con el
  // cliente asociado aunque su teléfono esté escrito en otro formato (si varios
  // coinciden: el activo más antiguo).
  async getConversations(query: PaginationQueryDto) {
    const paginated = isPaginated(query);
    const { limit, skip } = pageAndLimit(query);

    const rows: {
      phone: string;
      message: string;
      direction: string;
      createdAt: Date;
      contactName: string | null;
    }[] = await this.messagesRepository.query(
      `
      SELECT last.phone, last.message, last.direction, last."createdAt",
             contact."contactName"
      FROM (
        SELECT DISTINCT ON (phone) phone, message, direction, "createdAt"
        FROM "WHATSAPP_MESSAGES"
        ORDER BY phone, "createdAt" DESC
      ) last
      LEFT JOIN LATERAL (
        SELECT m."contactName" FROM "WHATSAPP_MESSAGES" m
        WHERE m.phone = last.phone AND m."contactName" IS NOT NULL
        ORDER BY m."createdAt" DESC
        LIMIT 1
      ) contact ON true
      ORDER BY last."createdAt" DESC, last.phone
      ${paginated ? 'LIMIT $1 OFFSET $2' : ''}
      `,
      paginated ? [limit, skip] : [],
    );

    const customers = await this.inbox.findCustomersByPhones(
      rows.map((row) => row.phone),
    );

    const conversations = rows.map((row) => ({
      phone: row.phone,
      customerId: customers.get(row.phone)?.id ?? null,
      customerName: customers.get(row.phone)?.name ?? 'Cliente desconocido',
      // Nombre que el contacto tiene en WhatsApp (útil si no es cliente).
      contactName: row.contactName ?? null,
      lastMessage: row.message ?? '',
      lastMessageDirection: row.direction,
      lastMessageDate: row.createdAt ?? null,
    }));

    if (!paginated) {
      return conversations;
    }

    const [{ total }] = await this.messagesRepository.query(
      'SELECT COUNT(DISTINCT phone)::int AS total FROM "WHATSAPP_MESSAGES"',
    );

    return toPaginated(conversations, total, query);
  }
}
