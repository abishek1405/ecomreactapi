const mongoose = require('mongoose')

const orderSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    items: [
      {
        productId: String,
        title: String,
        price: Number,
        quantity: Number,
      },
    ],
    totalAmount: Number,
    paymentId: String,
    orderId: String,
    status: {
      type: String,
      default: 'PAID',
    },
  },
  {timestamps: true},
)

module.exports = mongoose.model('Order', orderSchema)
