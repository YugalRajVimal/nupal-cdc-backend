import mongoose from 'mongoose';

const maintenanceSchema = new mongoose.Schema({
    isMaintenanceMode: {
        type: Boolean,
        required: true,
        default: false
    }
});

const Maintenance = mongoose.model('Maintenance', maintenanceSchema);

export default Maintenance;

