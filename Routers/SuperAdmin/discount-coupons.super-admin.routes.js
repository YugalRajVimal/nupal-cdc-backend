import express from 'express';
import DiscountAdminController from '../../Controllers/SuperAdmin/discount.controller.js';

const discountCouponRouter = express.Router();
const discountAdminController = new DiscountAdminController();

/**
 * @route POST /api/admin/discount-coupons
 * @desc Create a new discount coupon
 */
discountCouponRouter.post('/', (req, res) =>
  discountAdminController.addDiscount(req, res)
);

/**
 * @route PUT /api/admin/discount-coupons/:couponCode
 * @desc Edit/update a discount coupon
 */
discountCouponRouter.put('/:couponCode', (req, res) =>
  discountAdminController.editDiscount(req, res)
);

/**
 * @route DELETE /api/admin/discount-coupons/:couponCode
 * @desc Delete a discount coupon
 */
discountCouponRouter.delete('/:couponCode', (req, res) =>
  discountAdminController.deleteDiscount(req, res)
);

/**
 * @route GET /api/admin/discount-coupons
 * @desc Get all discount coupons
 */
discountCouponRouter.get('/', (req, res) =>
  discountAdminController.getDiscounts(req, res)
);

/**
 * @route GET /api/admin/discount-coupons/:couponCode
 * @desc Get a single discount coupon by coupon code
 */
discountCouponRouter.get('/:couponCode', (req, res) =>
  discountAdminController.getDiscounts(req, res)
);

export default discountCouponRouter;
