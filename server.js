require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion } = require('mongodb');
const Razorpay = require('razorpay')
const crypto = require('crypto')






const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
})


const app = express();
app.use(cors());
app.use(express.json())


// serve images publicly
app.use('/uploads', express.static('uploads'));


const uri = process.env.MONGO_URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

let usersCollection;
let productsCollection;
let cartCollection;
let ordersCollection;
let db;
// Connect to MongoDB
async function connectDB() {
  try {
    await client.connect();
    db = client.db("myAppDB"); // create/use your DB
    usersCollection = db.collection("users"); // create/use "users" collection
    productsCollection = db.collection("products"); // create/use "products" collection
    cartCollection = db.collection("cart"); // create/use "cart" collection
    ordersCollection = db.collection("orders"); // create/use "orders" collection
    console.log("Connected to MongoDB!");
  } catch (err) {
    console.error("MongoDB connection error:", err);
  }
}
connectDB();



// Secret key for JWT
const JWT_SECRET = process.env.JWT_SECRET;

function authenticateToken(req, res, next) { 
  const authHeader = req.headers['authorization']; 
  if (!authHeader) 
    return res.status(401).json({ error_msg: "No token provided" }); 
  const token = authHeader.split(' ')[1]; 
  jwt.verify(token, JWT_SECRET, (err, user) => { 
    if (err) return res.status(403).json({ error_msg: "Invalid token" }); 
    req.user = user; next(); 
  }); }

// ------------------- SIGNUP API -------------------

app.post('/signup', async (req, res) => {
  const { username, password, number } = req.body;
  if (!username || !password || !number) {
    return res.status(400).json({ error_msg: "All fields are required" });
  }

  const existingUser = await usersCollection.findOne({ username });
  if (existingUser) {
    return res.status(400).json({ error_msg: "User already exists" });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const result = await usersCollection.insertOne({ username, password: hashedPassword, number });

  // Use the inserted user's _id
  const userId = result.insertedId;

  const token = jwt.sign({ username, id: userId }, JWT_SECRET, { expiresIn: "30d" });

  res.json({ jwt_token: token });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  console.log('Login attempt for username:', username);
  const user = await usersCollection.findOne({ username });
  if (!user) {
    return res.status(400).json({ error_msg: "Invalid username" });
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    return res.status(400).json({ error_msg: "Invalid password" });
  }

  // Create JWT with username and MongoDB _id
  const token = jwt.sign({ username: user.username, id: user._id }, JWT_SECRET, { expiresIn: "30d" });

  res.json({ jwt_token: token });
});


// ------------------- PROTECTED ROUTE EXAMPLE -------------------
app.get('/profile', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error_msg: "No token provided" });

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await usersCollection.findOne({ username: decoded.username });
    res.json({ user });
  } catch (err) {
    res.status(401).json({ error_msg: "Invalid token" });
  }
});




app.get('/products', authenticateToken, async (req, res) => { 
  try { 
  const { sort_by, category, title_search, rating } = req.query; 
  let filterQuery = {}; 
  if (category) filterQuery.categoryId = category; 
  if (title_search) filterQuery.title = { $regex: title_search, $options: 'i' }; 
  if (rating) filterQuery.rating = { $gte: Number(rating) }; 
  let sortQuery = {}; 
  if (sort_by === 'PRICE_HIGH') sortQuery.price = -1; 
  else if (sort_by === 'PRICE_LOW') sortQuery.price = 1; 
  const product = await productsCollection
  .find(filterQuery)
  .sort(sortQuery)
  .toArray();
  res.status(200).json({ product}); } 
  catch (error) { console.error(error); 
  res.status(500).json({ error_msg: 'Internal Server Error' }); 
} });




app.get('/products/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const product = await productsCollection.findOne({
      id: id
    });
    if (!product) {
      console.log('Product not found for id:', id);
      return res.status(404).json({ error_msg: 'Product not found' });
    }
    res.status(200).json({ product});
  } catch (error) {
    console.error(error);
    res.status(500).json({ error_msg: 'Internal Server Error' });
  }
});



app.post('/cart', authenticateToken, async (req, res) => {
  try {
    const { productId, title, price, imageUrl, quantity } = req.body;
    const username = req.user.username;

    const existingCart = await cartCollection.findOne({ username });

    if (existingCart) {
      const productIndex = existingCart.items.findIndex(
        item => item.productId === productId
      );

      if (productIndex !== -1) {
        // update quantity
        existingCart.items[productIndex].quantity += quantity;
      } else {
        existingCart.items.push({ productId, title, price, imageUrl, quantity });
      }

      await cartCollection.updateOne(
        { username },
        { $set: { items: existingCart.items, updatedAt: new Date() } }
      );
    } else {
      await cartCollection.insertOne({
        username,
        items: [{ productId, title, price, imageUrl, quantity }],
        updatedAt: new Date()
      });
    }

    res.status(200).json({ message: "Item added to cart" });
  } catch (error) {
    res.status(500).json({ error_msg: "Failed to add cart item" });
  }
});


app.get('/cart', authenticateToken, async (req, res) => {
  try {
    const username = req.user.username;
    const cart = await cartCollection.findOne({ username });
    res.json({ items: cart ? cart.items : [] });
  } catch (error) {
    res.status(500).json({ error_msg: "Failed to fetch cart" });
  }
});


app.delete('/cart/:productId', authenticateToken, async (req, res) => {
  const { productId } = req.params;
  const username = req.user.username;

  await cartCollection.updateOne(
    { username },
    { $pull: { items: { productId } } }
  );

  res.json({ message: "Item removed" });
});


app.delete('/cart', authenticateToken, async (req, res) => {
  try {
    const username = req.user.username

    await cartCollection.updateOne(
      { username },
      { $set: { items: [] } }
    )

    res.json({ message: 'All cart items removed' })
  } catch (error) {
    res.status(500).json({ error_msg: 'Failed to clear cart' })
  }
})


app.put('/cart/increment/:productId', authenticateToken, async (req, res) => {
  const {productId} = req.params
  const username = req.user.username

  await cartCollection.updateOne(
    {username, 'items.productId': productId},
    {$inc: {'items.$.quantity': 1}}
  )

  res.json({message: 'Quantity increased'})
})



app.put('/cart/decrement/:productId', authenticateToken, async (req, res) => {
  const {productId} = req.params
  const username = req.user.username

  const cart = await cartCollection.findOne({username})
  const item = cart.items.find(i => i.productId === productId)

  if (item.quantity > 1) {
    await cartCollection.updateOne(
      {username, 'items.productId': productId},
      {$inc: {'items.$.quantity': -1}}
    )
  }

  res.json({message: 'Quantity decreased'})
})




app.post('/create-order', authenticateToken, async (req, res) => {
  try {
    const {amount} = req.body // amount in rupees
    const options = {
      amount: amount * 100, // Razorpay needs paise
      currency: 'INR',
      receipt: `receipt_${Date.now()}`,
    }
    const order = await razorpay.orders.create(options)
    res.json(order)
  } catch (error) {
    res.status(500).json({error_msg: 'Order creation failed'})
  }
})


app.post('/verify-payment', authenticateToken, async (req, res) => {
  const {razorpay_order_id, razorpay_payment_id, razorpay_signature} = req.body
  const sign = razorpay_order_id + '|' + razorpay_payment_id
  const expectedSign = crypto
    .createHmac('sha256', 'QiAdoDsbU6fVFfYY0UOudPKv')
    .update(sign)
    .digest('hex')

  if (expectedSign === razorpay_signature) {
    res.json({message: 'Payment verified successfully'})
  } else {
    res.status(400).json({error_msg: 'Invalid signature'})
  }
})

app.post('/save-order', authenticateToken, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, cartList, totalAmount } = req.body;

    // Find user
    const user = await usersCollection.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Save order
    const newOrder = {
      userId: user._id,
      items: cartList,
      totalAmount,
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      status: 'PAID',
      createdAt: new Date(),
    };

    await db.collection("orders").insertOne(newOrder);

    // Clear cart
    await cartCollection.updateOne(
      { username: req.user.username },
      { $set: { items: [] } }
    );

    res.json({ status: 'success' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Order save failed' });
  }
});


app.get('/orders', authenticateToken, async (req, res) => {
  try {
    const user = await usersCollection.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const orders = await ordersCollection.find({ userId: user._id }).toArray();
    res.json(orders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to retrieve orders' });
  }
});


// ------------------- START SERVER -------------------
const PORT = 5000;
app.listen(PORT, '0.0.0.0',() => {
  console.log(`Server running on http://localhost:${PORT}`);
});


