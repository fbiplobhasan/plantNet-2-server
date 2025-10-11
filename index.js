require('dotenv').config()
const express = require('express')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const jwt = require('jsonwebtoken')
const morgan = require('morgan')
const nodemailer = require("nodemailer");
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY)

const port = process.env.PORT || 9000
const app = express()
// middleware
const corsOptions = {
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  credentials: true,
  optionSuccessStatus: 200,
}
app.use(cors(corsOptions))

app.use(express.json())
app.use(cookieParser())
app.use(morgan('dev'))

const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token

  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err)
      return res.status(401).send({ message: 'unauthorized access' })
    }
    req.user = decoded
    next()
  })
}

// send email useng nodemailer
const sendEmail = (emailAddress, emailData) => {
  // create transporter
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.NODEMAILER_USER,
      pass: process.env.NODEMAILER_PASS,
    }
  })
  // verifyconnection
  transporter.verify((error, success) => {
    if (error) {
      console.log(error);
    } else {
      console.log('Transporter is ready to send emails', success);
    }
  })
  // transporter.sendMail()
  const mailBody = {
    from: process.env.NODEMAILER_USER,
    to: emailAddress,
    subject: emailData?.subject,
    html: `<p>${emailData?.message}</p>`,
  }
  // send email
  transporter.sendMail(mailBody, (error, info) => {
    if (error) {
      console.log(error);
    } else {
      console.log(info);
      console.log('Email Sent:' + info.response);
    }
  })
}

const uri = 'mongodb://localhost:27017'

// const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dqhfr.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`


// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})
async function run() {
  try {

    const db = client.db('plantNet-2')
    const userCollection = db.collection('users')
    const plantCollection = db.collection('plants')
    const orderCollection = db.collection('orders')

    // verify admin middleware
    const verifyAdmin = async (req, res, next) => {
      // console.log('data from verifyAdmin middleware---->', req.user?.email);
      const email = req.user?.email;
      const query = { email };
      // const query = { email: 'abc@gmail.com' }; testing with fake email
      const result = await userCollection.findOne(query);
      if (!result || result.role !== 'admin') return res.status(403).send({ message: 'Forbidden Access! Admin only Action!' })
      next();
    }
    // verify admin middleware
    const verifySeller = async (req, res, next) => {
      // console.log('data from verifyAdmin middleware---->', req.user?.email);
      const email = req.user?.email;
      const query = { email };
      // const query = { email: 'abc@gmail.com' }; testing with fake email
      const result = await userCollection.findOne(query);
      if (!result || result.role !== 'seller') return res.status(403).send({ message: 'Forbidden Access! Admin only Action!' })
      next();
    }

    // save or update a user in db
    app.post('/users/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = req.body;
      // check if user exist in db
      const isExist = await userCollection.findOne(query);
      if (isExist) {
        return res.send(isExist);
      }
      const result = await userCollection.insertOne({
        ...user,
        role: 'customer',
        timestamp: Date.now()
      });
      res.send(result);
    })

    // manage user status and role
    app.patch('/users/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email };
      // check already requested or no
      const user = await userCollection.findOne(query);
      if (!user || user?.status === 'Requested') return res.status(400).send('You have already requested, wait for some time.');
      // update status
      const updateDoc = {
        $set: {
          status: 'Requested'
        }
      }
      const result = await userCollection.updateOne(query, updateDoc);
      res.send(result);
    })

    // get all user data
    app.get('/all-users/:email', verifyToken, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const query = { email: { $ne: email } };
      const result = await userCollection.find(query).toArray();
      res.send(result);
    })

    // update a user role & status
    app.patch('/user/role/:email', verifyToken, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const { role } = req.body;
      const filter = { email };
      const updateDoc = {
        $set: { role, status: 'Requested' },
      }
      const result = await userCollection.updateOne(filter, updateDoc);
      res.send(result);
    })

    // get inventory data for seller
    app.get('/plants/seller', verifyToken, verifySeller, async (req, res) => {
      const email = req.user.email;
      const result = await plantCollection.find({ 'seller.email': email }).toArray();
      res.send(result)
    })

    // delete a plant from db by seller
    app.delete('/plants/:id', verifyToken, verifySeller, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await plantCollection.deleteOne(query);
      res.send(result);
    })

    // get user role
    app.get('/users/role/:email', async (req, res) => {
      const email = req.params.email;
      const result = await userCollection.findOne({ email });
      res.send({ role: result?.role })
    })

    // Generate jwt token
    app.post('/jwt', async (req, res) => {
      const email = req.body
      const token = jwt.sign(email, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '365d',
      })
      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true })
    })
    // Logout
    app.get('/logout', async (req, res) => {
      try {
        res
          .clearCookie('token', {
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
          })
          .send({ success: true })
      } catch (err) {
        res.status(500).send(err)
      }
    })

    // save a plant data in db
    app.post('/plants', verifyToken, verifySeller, async (req, res) => {
      const plant = req.body;
      const result = await plantCollection.insertOne(plant);
      res.send(result);
    })

    // get all plants from db
    app.get('/plants', async (req, res) => {
      const result = await plantCollection.find().toArray();
      res.send(result);
    })

    // get a plant by id
    app.get('/plants/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await plantCollection.findOne(query);
      res.send(result);
    })

    // save order data in db
    app.post('/order', verifyToken, async (req, res) => {
      const orderInfo = req.body;
      const result = await orderCollection.insertOne(orderInfo);
      // send Email
      if (result?.insertedId) {
        // To Custemer
        sendEmail(orderInfo?.customer?.email, {
          subject: 'Order successful.',
          message: `You've placed an order successfully. Transaction id: ${result?.insertedId}`
        })

        // To Seller
        sendEmail(orderInfo.seller, {
          subject: 'Hurray!, You have an order to process.',
          message: `Get the plants ready for ${orderInfo?.customer?.name}`
        })

      }
      res.send(result);
    })

    // manage plant quantity (increase or decrease)
    app.patch('/plants/quantity/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const { quantityToUpdate, status } = req.body;
      const filter = { _id: new ObjectId(id) };
      let updateDoc = {
        $inc: { quantity: -quantityToUpdate }
      }
      if (status === 'increase') {
        updateDoc = {
          $inc: { quantity: quantityToUpdate }
        }
      }
      const result = await plantCollection.updateOne(filter, updateDoc);
      res.send(result);
    })

    // get all orders for a specific user
    app.get('/customer-orders/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      const result = await orderCollection.aggregate([
        {
          $match: { 'customer.email': email }
        },
        {
          $addFields: {
            plantId: { $toObjectId: '$plantId' }
          }
        },
        {
          $lookup: {
            from: 'plants',
            localField: 'plantId',
            foreignField: '_id',
            as: 'plants'
          }
        },
        {
          $unwind: '$plants'
        },
        {
          $addFields: {
            name: '$plants.name',
            image: '$plants.image',
            category: '$plants.category'
          }
        },
        {
          $project: {
            plants: 0,
          }
        }
      ]).toArray();
      res.send(result);
    })

    // get all orders for a specific seller
    app.get('/seller-orders/:email', verifyToken, verifySeller, async (req, res) => {
      const email = req.params.email;
      const result = await orderCollection.aggregate([
        {
          $match: { seller: email },
        },
        {
          $addFields: {
            plantId: { $toObjectId: '$plantId' }
          }
        },
        {
          $lookup: {
            from: 'plants',
            localField: 'plantId',
            foreignField: '_id',
            as: 'plants'
          }
        },
        {
          $unwind: '$plants'
        },
        {
          $addFields: {
            name: '$plants.name'
          }
        },
        {
          $project: {
            plants: 0,
          }
        }
      ]).toArray();
      res.send(result);
    })

    // update a order status
    app.patch('/orders/:id', verifyToken, verifySeller, async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: { status },
      }
      const result = await orderCollection.updateOne(filter, updateDoc);
      res.send(result);
    })

    // cancel/delete an order
    app.delete('/orders/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      // status check with return status code
      const order = await orderCollection.findOne(query);
      if (order.status === 'Delivered') return res.status(409).send('Cannot cancel once the product is delivered');
      // delete/cancel this product
      const result = await orderCollection.deleteOne(query);
      res.send(result);
    })

    // admin stat
    app.get('/admin-stat', verifyToken, verifyAdmin, async (req, res) => {
      // get total user, total plants
      const totalUser = await userCollection.estimatedDocumentCount()
      const totalPlants = await plantCollection.estimatedDocumentCount()

      const allOrder = await orderCollection.find().toArray()
      // const totalOrders = allOrder.length
      // const totalPrice = allOrder.reduce((sum, order) => sum + order.price, 0)

      // const myData = {
      //   date: '11/01/2025',
      //   quantity: 12,
      //   price: 1500,
      //   order: 3,
      // }
      // generate chart data
      const chartData = await orderCollection
        .aggregate([
          { $sort: { _id: -1 } },
          {
            $addFields: {
              _id: {
                $dateToString: {
                  format: '%Y-%m-%d',
                  date: { $toDate: '$_id' },
                },
              },
              quantity: {
                $sum: '$quantity',
              },
              price: { $sum: '$price' },
              order: { $sum: 1 },
            },
          },

          {
            $project: {
              _id: 0,
              date: '$_id',
              quantity: 1,
              order: 1,
              price: 1,
            },
          },
        ])
        .toArray()

      // get total revenue, total order
      const orderDetails = await orderCollection
        .aggregate([
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: '$price' },
              totalOrder: { $sum: 1 },
            },
          },
          {
            $project: {
              _id: 0,
            },
          },
        ])
        .next()

      res.send({
        totalPlants,
        totalUser,
        ...orderDetails,
        chartData,
      })
    })

    // create payment intent
    app.post('/create-payment-intent', verifyToken, async (req, res) => {
      const { quantity, plantId } = req.body
      const plant = await plantCollection.findOne({
        _id: new ObjectId(plantId),
      })
      if (!plant) {
        return res.status(400).send({ message: 'Plant Not Found' })
      }
      const totalPrice = quantity * plant.price * 100 // total price in cent (poysha)
      const { client_secret } = await stripe.paymentIntents.create({
        amount: totalPrice,
        currency: 'usd',
        automatic_payment_methods: {
          enabled: true,
        },
      })
      res.send({ clientSecret: client_secret })
    })

    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from plantNet Server..')
})

app.listen(port, () => {
  console.log(`plantNet is running on port ${port}`)
})
