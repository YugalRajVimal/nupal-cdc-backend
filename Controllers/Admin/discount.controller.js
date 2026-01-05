import DiscountModel from "../../Schema/discount.schema.js";



class DiscountAdminController {
  // POST /admin/discounts
  // Add/create a new discount coupon
  async addDiscount(req, res) {
    try {
      const { discountEnabled, discount, couponCode, validityDays } = req.body;

      // Validate required fields
      if (!couponCode || typeof discount !== 'number') {
        return res.status(400).json({ error: "couponCode (string) and discount (number) are required." });
      }

      // Check if couponCode already exists
      const exists = await DiscountModel.findOne({ couponCode });
      if (exists) {
        return res.status(409).json({ error: "A coupon with that code already exists." });
      }

      const discountDoc = new DiscountModel({
        discountEnabled: discountEnabled ?? false,
        discount,
        couponCode,
        validityDays: validityDays || 1,
      });

      await discountDoc.save();
      res.status(201).json({ success: true, data: discountDoc });
    } catch (err) {
      res.status(500).json({ error: err.message || String(err) });
    }
  }

  // PUT /admin/discounts/:couponCode
  // Edit/update a discount coupon (by couponCode)
  async editDiscount(req, res) {
    try {
      const { couponCode } = req.params;
      if (!couponCode) {
        return res.status(400).json({ error: "couponCode parameter required." });
      }
      const { discountEnabled, discount, validityDays } = req.body;

      const update = {};
      if (typeof discountEnabled === 'boolean') update.discountEnabled = discountEnabled;
      if (typeof discount === 'number') update.discount = discount;
      if (typeof validityDays === 'number') update.validityDays = validityDays;

      const doc = await DiscountModel.findOneAndUpdate(
        { couponCode },
        update,
        { new: true }
      );

      if (!doc) {
        return res.status(404).json({ error: "Discount coupon not found." });
      }

      res.json({ success: true, data: doc });
    } catch (err) {
      res.status(500).json({ error: err.message || String(err) });
    }
  }

  // GET /admin/discounts
  // GET /admin/discounts/:couponCode
  // Fetch all discounts, or a single coupon if couponCode supplied
  async getDiscounts(req, res) {
    try {
      const { couponCode } = req.params;
      if (couponCode) {
        // Get single coupon by couponCode
        const doc = await DiscountModel.findOne({ couponCode });
        if (!doc) {
          return res.status(404).json({ error: "Discount coupon not found." });
        }
        return res.json({ success: true, data: doc });
      }
      // Get all coupons
      const docs = await DiscountModel.find().sort({ createdAt: -1 });
      res.json({ success: true, data: docs });
    } catch (err) {
      res.status(500).json({ error: err.message || String(err) });
    }
  }

  // DELETE /admin/discounts/:couponCode
  // Delete a discount coupon by couponCode
  async deleteDiscount(req, res) {
    try {
      const { couponCode } = req.params;
      if (!couponCode) {
        return res.status(400).json({ error: "couponCode parameter required." });
      }

      const result = await DiscountModel.findOneAndDelete({ couponCode });
      if (!result) {
        return res.status(404).json({ error: "Discount coupon not found." });
      }
      res.json({ success: true, message: "Coupon deleted", data: result });
    } catch (err) {
      res.status(500).json({ error: err.message || String(err) });
    }
  }
}

export default DiscountAdminController;
