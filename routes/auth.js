const express = require('express');
const router = express.Router();
const { check, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('config');
const auth = require('../middleware/auth');
const User = require('../models/User');
const nodemailer = require('nodemailer');

// @route    GET api/auth
// @desc     get logged in user
// @access   Private
router.get('/', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json(user);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route    POST api/auth
// @desc     Auth user & get token
// @access   Public
router.post(
  '/',
  [
    check('email', 'Please include a valid email').isEmail(),
    check('password', 'Password is required').exists(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, isVerified } = req.body;

    try {
      let user = await User.findOne({ email });

      if (!user) {
        return res.status(400).json({ msg: 'Invalid Credentials' });
      }

      const isMatch = await bcrypt.compare(password, user.password);

      if (!isMatch) {
        return res.status(400).json({ msg: 'Invalid Credentials' });
      }

      if (isVerified) {
        return res.status(400).json({
          type: 'not-verified',
          msg: 'Your account has not been verified.',
        });
      }

      const payload = {
        user: {
          id: user.id,
        },
      };

      jwt.sign(
        payload,
        config.get('jwtSecret'),
        {
          expiresIn: 360000,
        },
        (err, token) => {
          if (err) throw err;
          res.json({ token });
        }
      );
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server Error');
    }
  }
);

// @route POST api/auth/recover
// @desc Recover Password - Generates token and Sends password reset email
// @access Public

router.post(
  '/recover',
  [check('email', 'Please include a valid email').isEmail()],
  async (req, res) => {
    try {
      const { email } = req.body;

      let user = await User.findOne({ email });

      if (!user) {
        return res.status(401).json({
          msg: `The email address ${req.body.email} is not associated with any account. Double-check your email adress and try again`,
        });
      }

      await user.generatePasswordReset();

      await user.save();

      let transporter = nodemailer.createTransport({
        service: 'Gmail',
        auth: {
          user: config.get('email'),
          pass: config.get('password'),
        },
      });

      let url = `http://${req.headers.host}/api/auth/reset/${user.resetPasswordToken}`;

      let mailOptions = {
        from: config.get('email'),
        to: user.email,
        subject: 'Account Verification Token',
        html: `Please click the following link: <a href='${url}' target="_blank"> ${url} </a> to reset your password \n\n
      If you did not request this, please ignore this email and your password will remain unchanged.`,
      };
      transporter.sendMail(mailOptions, (err) => {
        if (err) {
          return res.status(500).send({ msg: err.message });
        }
        res
          .status(200)
          .send(`A verification email has been sent to ${user.email}`);
      });
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server Error');
    }
  }
);

router.get('/reset/:token', async (req, res) => {
  try {
    let user = await User.findOne({
      resetPasswordToken: req.params.token,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(401).json({
        msg: `Password reset token is invalid or has expired`,
      });
    }
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

router.post(
  '/reset/:token',
  [
    check('password', 'Password must be at least 6 chars long').isLength({
      min: 6,
    }),
  ],
  async (req, res) => {
    try {
      let user = await User.findOne({
        resetPasswordToken: req.params.token,
        resetPasswordExpires: { $gt: Date.now() },
      });

      if (!user) {
        return res.status(401).json({
          msg: `Password reset token is invalid or has expired`,
        });
      }
      console.log(req.body.password);

      //Set the new password
      user.password = req.body.password;
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;

      await user.save((err) => {
        if (err) return res.status(500).json({ msg: err.message });

        // Send the Email

        let transporter = nodemailer.createTransport({
          service: 'Gmail',
          auth: {
            user: config.get('email'),
            pass: config.get('password'),
          },
        });

        let mailOptions = {
          from: config.get('email'),
          to: user.email,
          subject: 'Your password has been changed',
          html: `Hi ${user.name} \n This is a confirmation that the password for your account ${user.email} has just been changed. \n`,
        };
        transporter.sendMail(mailOptions, (err) => {
          if (err) {
            return res.status(500).send({ msg: err.message });
          }
          res.status(200).send(`Your password has been updated.`);
        });
      });
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server Error');
    }
  }
);

module.exports = router;
