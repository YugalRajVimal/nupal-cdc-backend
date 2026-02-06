import DiscountModel from "../../Schema/discount.schema.js";
import AuditLogService from "../AuditLogs/audit-logs.controller.js";

class DiscountAdminController {
  // POST /admin/discounts
  // Add/create a new discount coupon
  async addDiscount(req, res) {
    const session = await DiscountModel.startSession();
    try {
      session.startTransaction();

      const { discountEnabled, discount, couponCode, validityDays } = req.body;

      // Validate required fields
      if (!couponCode || typeof discount !== 'number') {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: "couponCode (string) and discount (number) are required." });
      }

      // Check if couponCode already exists
      const exists = await DiscountModel.findOne({ couponCode }).session(session);
      if (exists) {
        await session.abortTransaction();
        session.endSession();
        return res.status(409).json({ error: "A coupon with that code already exists." });
      }

      const discountDoc = new DiscountModel({
        discountEnabled: discountEnabled ?? false,
        discount,
        couponCode,
        validityDays: validityDays || 1,
      });

      await discountDoc.save({ session });

      // === Mandatory Audit Log (must succeed for transaction) ===
      try {
        await AuditLogService.addLog(
          {
            action: "ADD_DISCOUNT_COUPON",
            user: req.user && req.user.id ? req.user.id : null,
            role: req.user && req.user.role ? req.user.role : undefined,
            resource: "Discount",
            resourceId: discountDoc._id,
            details: {
              changedFields: {
                discountEnabled: { from: undefined, to: discountEnabled ?? false },
                discount: { from: undefined, to: discount },
                couponCode: { from: undefined, to: couponCode },
                validityDays: { from: undefined, to: validityDays || 1 },
              },
              message: `Discount coupon "${couponCode}" created by userId=${req.user ? req.user.id : "?"}`
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (elog) {
        await session.abortTransaction();
        session.endSession();
        console.error("[addDiscount] Error writing audit log:", elog);
        return res.status(500).json({ message: "Audit log creation failed. Discount not saved." });
      }

      await session.commitTransaction();
      session.endSession();

      res.status(201).json({ success: true, data: discountDoc });
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      res.status(500).json({ error: err.message || String(err) });
    }
  }

  // PUT /admin/discounts/:couponCode
  // Edit/update a discount coupon (by couponCode)
  async editDiscount(req, res) {
    const session = await DiscountModel.startSession();
    try {
      session.startTransaction();

      const { couponCode } = req.params;
      if (!couponCode) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: "couponCode parameter required." });
      }
      const { discountEnabled, discount, validityDays } = req.body;

      const discountDoc = await DiscountModel.findOne({ couponCode }).session(session);
      if (!discountDoc) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ error: "Discount coupon not found." });
      }

      let changedFields = {};
      if (typeof discountEnabled === 'boolean' && discountEnabled !== discountDoc.discountEnabled) {
        changedFields.discountEnabled = { from: discountDoc.discountEnabled, to: discountEnabled };
        discountDoc.discountEnabled = discountEnabled;
      }
      if (typeof discount === 'number' && discount !== discountDoc.discount) {
        changedFields.discount = { from: discountDoc.discount, to: discount };
        discountDoc.discount = discount;
      }
      if (typeof validityDays === 'number' && validityDays !== discountDoc.validityDays) {
        changedFields.validityDays = { from: discountDoc.validityDays, to: validityDays };
        discountDoc.validityDays = validityDays;
      }

      await discountDoc.save({ session });

      // === Mandatory Audit Log (must succeed for transaction) ===
      try {
        await AuditLogService.addLog(
          {
            action: "EDIT_DISCOUNT_COUPON",
            user: req.user && req.user.id ? req.user.id : null,
            role: req.user && req.user.role ? req.user.role : undefined,
            resource: "Discount",
            resourceId: discountDoc._id,
            details: {
              changedFields,
              message: `Discount coupon "${couponCode}" updated by userId=${req.user ? req.user.id : "?"}`
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (elog) {
        await session.abortTransaction();
        session.endSession();
        console.error("[editDiscount] Error writing audit log:", elog);
        return res.status(500).json({ message: "Audit log creation failed. Discount update not saved." });
      }

      await session.commitTransaction();
      session.endSession();

      res.json({ success: true, data: discountDoc });
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
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
  // async deleteDiscount(req, res) {
  //   const session = await DiscountModel.startSession();
  //   try {
  //     session.startTransaction();

  //     const { couponCode } = req.params;
  //     if (!couponCode) {
  //       await session.abortTransaction();
  //       session.endSession();
  //       return res.status(400).json({ error: "couponCode parameter required." });
  //     }

  //     const discountDoc = await DiscountModel.findOne({ couponCode }).session(session);
  //     if (!discountDoc) {
  //       await session.abortTransaction();
  //       session.endSession();
  //       return res.status(404).json({ error: "Discount coupon not found." });
  //     }

  //     await DiscountModel.deleteOne({ couponCode }).session(session);

  //     // === Mandatory Audit Log (must succeed for transaction) ===
  //     try {
  //       await AuditLogService.addLog(
  //         {
  //           action: "DELETE_DISCOUNT_COUPON",
  //           user: req.user && req.user.id ? req.user.id : null,
  //           role: req.user && req.user.role ? req.user.role : undefined,
  //           resource: "Discount",
  //           resourceId: discountDoc._id,
  //           details: {
  //             changedFields: {
  //               discountEnabled: { from: discountDoc.discountEnabled, to: undefined },
  //               discount: { from: discountDoc.discount, to: undefined },
  //               couponCode: { from: discountDoc.couponCode, to: undefined },
  //               validityDays: { from: discountDoc.validityDays, to: undefined },
  //             },
  //             message: `Discount coupon "${couponCode}" deleted by userId=${req.user ? req.user.id : "?"}`
  //           },
  //           ipAddress: req.ip,
  //           userAgent: req.headers["user-agent"]
  //         },
  //         { session }
  //       );
  //     } catch (elog) {
  //       await session.abortTransaction();
  //       session.endSession();
  //       console.error("[deleteDiscount] Error writing audit log:", elog);
  //       return res.status(500).json({ message: "Audit log creation failed. Discount not deleted." });
  //     }

  //     await session.commitTransaction();
  //     session.endSession();

  //     res.json({ success: true, message: "Coupon deleted", data: discountDoc });
  //   } catch (err) {
  //     await session.abortTransaction();
  //     session.endSession();
  //     res.status(500).json({ error: err.message || String(err) });
  //   }
  // }
}

export default DiscountAdminController;
